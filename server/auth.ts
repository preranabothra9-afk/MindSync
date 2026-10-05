import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import os from 'os';
import { db } from './database';
import { User } from '../src/types';
import { registerSchema, loginSchema, forgotPasswordSchema, resetPasswordSchema } from './validators';
import { sendVerificationEmail, sendPasswordResetEmail, isMailConfigured } from './mailer';

// Helpers to get cryptographic keys
export function getJwtSecret(): string {
  const secret = process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET;
  if (!secret) {
    console.error('CRITICAL ERROR: Environment variable JWT_ACCESS_SECRET/JWT_SECRET is not defined!');
    throw new Error('JWT_ACCESS_SECRET environment variable is required for cryptographic security.');
  }
  return secret;
}

export function getJwtRefreshSecret(): string {
  const secret = process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET;
  if (!secret) {
    console.error('CRITICAL ERROR: Environment variable JWT_REFRESH_SECRET/JWT_SECRET is not defined!');
    throw new Error('JWT_REFRESH_SECRET environment variable is required for cryptographic security.');
  }
  return secret;
}

// Helpers to generate IDs
export function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Custom request interface with user
export interface AuthenticatedRequest extends Request {
  user?: User;
}

// Token generation helpers
export function generateAccessToken(user: User): string {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name, role: user.role },
    getJwtSecret(),
    { expiresIn: '15m' }
  );
}

// Alias generateToken as generateAccessToken to preserve backwards-compatibility where called
export function generateToken(user: User): string {
  return generateAccessToken(user);
}

export function generateRefreshToken(user: User): string {
  return jwt.sign(
    { id: user.id },
    getJwtRefreshSecret(),
    { expiresIn: '7d' }
  );
}

// Cookie configuration for high security HttpOnly Refresh Token
// `secure` must track the request scheme: a `Secure` cookie is discarded by
// browsers on plain HTTP, which would drop the refresh token on every localhost
// reload and force a re-login. `req.protocol` reflects the real scheme because
// Express is configured with `trust proxy` upstream.
export function getRefreshCookieOptions(req?: Request) {
  const isSecure = req ? req.protocol === 'https' : process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isSecure,
    // 'none' is only valid with Secure; fall back to 'lax' on HTTP origins.
    sameSite: (isSecure ? 'none' : 'lax') as 'none' | 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
  };
}

/**
 * Removes the refresh cookie. Unlike `res.cookie`, `res.clearCookie` applies
 * an immediate expiry on its own, so it must not receive `maxAge` — Express 5
 * ignores the option and logs a deprecation warning, and a stale `maxAge`
 * could even outrace the immediate expiry on some clients.
 */
export function clearRefreshCookie(res: Response, req?: Request) {
  const { maxAge: _omit, ...options } = getRefreshCookieOptions(req);
  res.clearCookie('refreshToken', options);
}

// Middleware to authenticate user
export async function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    let token = '';

    // Check Authorization Bearer headers
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({ error: 'Authentication required. Please log in.' });
    }

    const secret = getJwtSecret();
    const decoded = jwt.verify(token, secret) as { id: string; email: string; name: string; role: string };
    const user = await db.getUserById(decoded.id);

    if (!user) {
      return res.status(401).json({ error: 'User session invalid. Please log in again.' });
    }

    if (user.blocked) {
      return res.status(403).json({ error: 'Your account has been suspended by system administrators.' });
    }

    // Update user's lastActiveAt state asynchronously in Mongoose
    const { UserModel } = await import('./database');
    UserModel.findByIdAndUpdate(user.id, { lastActiveAt: new Date().toISOString() }).catch(() => {});

    req.user = user;
    next();
  } catch (err: any) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Session expired. Access token has expired.' });
    }
    return res.status(401).json({ error: 'Session expired or token invalid.' });
  }
}

/**
 * `requireAuth` plus a proven email address.
 *
 * Login already refuses to issue a token to an unverified account, so this
 * looks redundant — it is not. Tokens outlive verification: a session minted
 * before the mailbox was confirmed, a refresh token rotated since, or an
 * account an admin has since moved back to unverified would all still pass
 * `requireAuth`, which only checks the token, the session and the block flag.
 *
 * Every route that can change *who owns, joins, or can see* a workspace sits
 * behind this instead, so ownership and membership can only ever be created
 * by an account that has proven it controls its own mailbox.
 */
export async function requireVerifiedAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  // `requireAuth` answers 401/403 itself and never calls `next` on failure, so
  // this callback only runs for an authenticated, unblocked caller.
  await requireAuth(req, res, async () => {
    if (req.user && req.user.isVerified !== true) {
      res.status(403).json({ error: 'Verify your email address before working with workspaces.' });
      return;
    }
    next();
  });
}

// Role-based authorization middleware
export function requireRole(role: 'user' | 'admin') {  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (req.user.role !== role && req.user.role !== 'admin') {
      return res.status(403).json({ error: `Requires role: ${role}` });
    }
    next();
  };
}

// adminOnly middleware for strictly validating standard admin access controls
export function adminOnly(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: 'Access denied: Admin authentication required.' });
  }
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Access denied: Administrator status required.' });
  }
  next();
}

// Controller registrations
export async function handleRegister(req: Request, res: Response) {
  try {
    // 1. Zod request validation
    const validationResult = registerSchema.safeParse(req.body);
    if (!validationResult.success) {
      const firstErrorMessage = validationResult.error.issues[0]?.message || 'Validation failed';
      return res.status(400).json({
        success: false,
        message: firstErrorMessage
      });
    }

    const { name, email, password } = validationResult.data;

    const existing = await db.getUserByEmail(email);
    if (existing) {
      return res.status(400).json({ error: 'An account with this email already exists' });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Dynamic clean avatar letter
    const avatar = name.slice(0, 2).toUpperCase();

    const newUser: User = {
      id: generateUUID(),
      name,
      email: email.toLowerCase().trim(),
      avatar,
      role: 'user',
      createdAt: new Date().toISOString(),
    };

    const userObj = await db.createUser(newUser, passwordHash);

    // Issue an email verification token. The account stays locked until the
    // recipient confirms, so no session is minted here.
    const origin = resolvePublicOrigin(req);
    const { emailed, verificationUrl } = await issueVerificationLink(
      { id: userObj.id, name: userObj.name, email: userObj.email },
      origin
    );

    // Write audit log entry for registration
    await db.logAudit(userObj.id, userObj.name, userObj.email, 'REGISTER', 'User account created. Email verification pending.', undefined, req.ip);

    return res.status(201).json({
      message: 'Account created successfully',
      requiresVerification: true,
      emailSent: emailed,
      user: {
        id: userObj.id,
        name: userObj.name,
        email: userObj.email,
        avatar: userObj.avatar,
        role: userObj.role,
      },
      // Surfaced in development so the flow is testable without a mail server.
      // Also surfaced when mail delivery actually failed — otherwise a broken
      // SMTP server locks newly registered users out of their unverified
      // accounts with no way to obtain the link.
      ...(process.env.NODE_ENV !== 'production' || !emailed
        ? { verificationUrl, dev: process.env.NODE_ENV !== 'production', mailFailed: !emailed }
        : {}),
    });
  } catch (e: any) {
    console.error('Registration error:', e);
    return res.status(500).json({ error: 'Internal server registration error' });
  }
}

export async function handleLogin(req: Request, res: Response) {
  try {
    // 1. Zod request validation
    const validationResult = loginSchema.safeParse(req.body);
    if (!validationResult.success) {
      const firstErrorMessage = validationResult.error.issues[0]?.message || 'Validation failed';
      return res.status(400).json({
        success: false,
        message: firstErrorMessage
      });
    }

    const { email, password } = validationResult.data;

    const user = await db.getUserByEmail(email);
    if (!user) {
      await db.logAudit(undefined, undefined, email, 'FAILED_AUTH', `Failed login attempt with invalid email: ${email}`, undefined, req.ip);
      return res.status(400).json({ error: 'Invalid email or password' });
    }

    if (user.blocked) {
      await db.logAudit(user.id, user.name, user.email, 'FAILED_AUTH', 'Blocked user account attempted authentication.', undefined, req.ip);
      return res.status(403).json({ error: 'Your account has been suspended by system administrators.' });
    }

    // Unverified accounts cannot sign in. The password is still checked first so
    // this cannot be used to enumerate which emails are registered.
    const hash = await db.getPasswordHash(user.id);
    if (!hash) {
      return res.status(400).json({ error: 'User credentials database records missing' });
    }

    const isMatch = await bcrypt.compare(password, hash);
    if (!isMatch) {
      await db.logAudit(user.id, user.name, user.email, 'FAILED_AUTH', 'Failed login attempt: incorrect password.', undefined, req.ip);
      return res.status(400).json({ error: 'Invalid email or password' });
    }

    if (user.isVerified !== true) {
      await db.logAudit(user.id, user.name, user.email, 'FAILED_AUTH', 'Login blocked: email address not yet verified.', undefined, req.ip);
      return res.status(403).json({
        error: 'Please verify your email address before signing in.',
        requiresVerification: true,
        email: user.email,
      });
    }

    // Refresh user's lastActiveAt state in DB
    const { UserModel } = await import('./database');
    await UserModel.findByIdAndUpdate(user.id, { lastActiveAt: new Date().toISOString() }).catch(() => {});

    // Tokens generation
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    // Save refresh token in DB
    await UserModel.findByIdAndUpdate(user.id, { refreshToken }).catch(() => {});

    // Set refresh token in HttpOnly Cookie
    res.cookie('refreshToken', refreshToken, getRefreshCookieOptions(req));

    // Write audit log entry for login
    await db.logAudit(user.id, user.name, user.email, 'LOGIN', 'Authenticated session established successfully.', undefined, req.ip);

    return res.status(200).json({
      message: 'Logged in successfully',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        role: user.role,
      },
      token: accessToken,
    });
  } catch (e: any) {
    console.error('Login error:', e);
    return res.status(500).json({ error: 'Internal server login error' });
  }
}

export async function handleRefresh(req: Request, res: Response) {
  try {
    const refreshToken = req.cookies?.refreshToken;
    if (!refreshToken) {
      return res.status(401).json({ error: 'Session expired. Please log in again.' });
    }

    let decoded: any;
    try {
      decoded = jwt.verify(refreshToken, getJwtRefreshSecret());
    } catch (verifyErr) {
      return res.status(401).json({ error: 'Session expired. Invalid refresh token.' });
    }

    if (!decoded || !decoded.id) {
      return res.status(401).json({ error: 'Invalid refresh token payload.' });
    }

    const user = await db.getUserById(decoded.id);
    if (!user) {
      return res.status(401).json({ error: 'User session invalid. Please log in again.' });
    }

    if (user.blocked) {
      return res.status(403).json({ error: 'Your account has been suspended by system administrators.' });
    }

    // Verify token matches what's stored in MongoDB for security, detecting reuse/theft
    const { UserModel } = await import('./database');
    const userDoc = await UserModel.findById(user.id);
    if (!userDoc || userDoc.refreshToken !== refreshToken) {
      // Refresh token mismatch trigger: possible theft/hijack. Invalidate user refreshes!
      if (userDoc) {
        userDoc.refreshToken = null;
        await userDoc.save();
      }
      clearRefreshCookie(res, req);
      return res.status(401).json({ error: 'Session revoked due to token conflict. Please authenticate again.' });
    }

    // Rotate refresh token securely
    const nextAccessToken = generateAccessToken(user);
    const nextRefreshToken = generateRefreshToken(user);

    userDoc.refreshToken = nextRefreshToken;
    await userDoc.save();

    // Re-set updated cookie
    res.cookie('refreshToken', nextRefreshToken, getRefreshCookieOptions(req));

    return res.status(200).json({
      message: 'Token renewed successfully',
      token: nextAccessToken,
      accessToken: nextAccessToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        role: user.role
      }
    });
  } catch (err) {
    console.error('Token refreshing sequence error:', err);
    return res.status(500).json({ error: 'Failed to negotiate token rotation.' });
  }
}

export async function handleLogout(req: Request, res: Response) {
  try {
    const refreshToken = req.cookies?.refreshToken;
    if (refreshToken) {
      const { UserModel } = await import('./database');
      await UserModel.findOneAndUpdate({ refreshToken }, { refreshToken: null }).catch(() => {});
    }
  } catch (err) {
    console.warn('Logout database record traces exception:', err);
  }

  clearRefreshCookie(res, req);
  return res.status(200).json({ message: 'Logged out successfully' });
}

export function verifyCurrentUser(req: AuthenticatedRequest, res: Response) {
  if (!req.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  return res.status(200).json({
    user: {
      id: req.user.id,
      name: req.user.name,
      email: req.user.email,
      avatar: req.user.avatar,
      role: req.user.role,
    },
  });
}

// ─── PASSWORD RECOVERY ────────────────────────────────────────────────
// Tokens are stored as SHA-256 hashes so a database leak cannot redeem them.
// In development the issued link is returned in the response (no SMTP wired up);
// in production it would be delivered by email instead.

export async function handleForgotPassword(req: Request, res: Response) {
  try {
    const validationResult = forgotPasswordSchema.safeParse(req.body);
    if (!validationResult.success) {
      const firstErrorMessage = validationResult.error.issues[0]?.message || 'Validation failed';
      return res.status(400).json({ success: false, message: firstErrorMessage });
    }

    const { email } = validationResult.data;

    // Always respond identically so account existence is never leaked.
    const genericMessage = 'If an account exists for that email, a password reset link has been sent.';

    const user = await db.getUserByEmail(email);
    if (!user || user.blocked) {
      return res.status(200).json({ message: genericMessage });
    }

    const crypto = await import('crypto');
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = Date.now() + 60 * 60 * 1000; // 1 hour

    await db.setResetToken(user.id, tokenHash, expiresAt);
    await db.logAudit(
      user.id, user.name, user.email,
      'PASSWORD_RESET_REQUESTED',
      'Password reset token issued.',
      undefined, req.ip
    );

    const origin = (req.headers.origin || req.protocol + '://' + req.get('host')) as string;
    const resetUrl = `${origin}/reset-password?token=${rawToken}`;

    // Actually deliver the link. Without this the token was minted and stored
    // but never emailed, so the reset flow only worked in dev mode.
    const emailed = await sendPasswordResetEmail({
      to: user.email,
      name: user.name,
      resetUrl,
    });

    if (!emailed) {
      console.warn(`⚠️ Password reset email not sent (SMTP ${isMailConfigured() ? 'send failed' : 'unconfigured'}). Link: ${resetUrl}`);
    }

    const isDevelopment = process.env.NODE_ENV !== 'production';
    return res.status(200).json({
      message: genericMessage,
      // Dev surfaces it directly; production surfaces it only when mail
      // delivery actually failed, so a broken SMTP server can't dead-end the
      // user with no way to reach the reset form.
      ...(isDevelopment || !emailed
        ? { resetUrl, dev: isDevelopment, mailFailed: !emailed }
        : {}),
    });
  } catch (e: any) {
    console.error('Forgot password error:', e);
    return res.status(500).json({ error: 'Internal server error processing password reset request' });
  }
}

export async function handleResetPassword(req: Request, res: Response) {
  try {
    const validationResult = resetPasswordSchema.safeParse(req.body);
    if (!validationResult.success) {
      const firstErrorMessage = validationResult.error.issues[0]?.message || 'Validation failed';
      return res.status(400).json({ success: false, message: firstErrorMessage });
    }

    const { token, password } = validationResult.data;

    const crypto = await import('crypto');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const record = await db.getUserByResetToken(tokenHash);
    if (!record) {
      return res.status(400).json({ error: 'Invalid or unknown reset token.' });
    }

    const userId: string = record._id?.toString() || record.id;
    const expiresAt: number | null = record.resetTokenExpiresAt;
    if (!expiresAt || Date.now() > expiresAt) {
      // Expired — clear the stale token so it can't be retried
      await db.setResetToken(userId, '', 0).catch(() => {});
      return res.status(400).json({ error: 'This reset link has expired. Please request a new one.' });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    await db.setUserPassword(userId, passwordHash);
    await db.logAudit(
      userId, record.name, record.email,
      'PASSWORD_RESET',
      'Password successfully reset via recovery token.',
      undefined, req.ip
    );

    return res.status(200).json({ message: 'Password reset successful. Please sign in with your new password.' });
  } catch (e: any) {
    console.error('Reset password error:', e);
    return res.status(500).json({ error: 'Internal server error resetting password' });
  }
}

/**
 * Issues a fresh verification link. Shared by the resend endpoint and by
 * registration so both paths mint tokens identically.
 */
/**
 * Base URL to embed in verification emails.
 *
 * The browser Origin cannot be trusted here: signing up on a laptop yields
 * "http://localhost:3000", and on a phone "localhost" resolves to the phone
 * itself, so the emailed link is a dead end. APP_URL is the override, and in
 * development we fall back to the machine's LAN address so a link opened on a
 * phone on the same Wi-Fi actually reaches this server.
 */
function resolvePublicOrigin(req: Request): string {
  const configured = (process.env.APP_URL || '').trim().replace(/\/+$/, '');
  if (configured) return configured;

  if (process.env.NODE_ENV === 'production') {
    return ((req.headers.origin as string) || (req.protocol + '://' + req.get('host'))).replace(/\/+$/, '');
  }

  try {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] || []) {
        // `family` is a number (4/6) on modern @types/node and a string on
        // older ones, so compare defensively.
        const isIPv4 = (net as any).family === 4 || (net as any).family === 'IPv4';
        if (isIPv4 && !net.internal) {
          return `http://${net.address}:${process.env.PORT || 3000}`;
        }
      }
    }
  } catch {
    /* fall through to request host */
  }

  return ((req.headers.origin as string) || (req.protocol + '://' + req.get('host'))).replace(/\/+$/, '');
}

async function issueVerificationLink(
  user: { id: string; name: string; email: string },
  origin: string
): Promise<{ emailed: boolean; verificationUrl: string }> {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 hours

  await db.setVerifyToken(user.id, tokenHash, expiresAt);

  const verificationUrl = `${origin}/verify-email?token=${rawToken}`;
  const emailed = await sendVerificationEmail({
    to: user.email,
    name: user.name,
    verificationUrl,
  });

  if (!emailed) {
    console.warn(`⚠️ Verification email not sent (SMTP ${isMailConfigured() ? 'send failed' : 'unconfigured'}). Link: ${verificationUrl}`);
  }

  return { emailed, verificationUrl };
}

/** Resolve a raw token to its verification record, with no side effects. */
async function resolveVerifyToken(rawToken: string) {
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const record = await db.getUserByVerifyToken(tokenHash);
  if (!record) {
    return { record: null, state: 'invalid' as const };
  }
  const userId: string = record._id?.toString() || record.id;
  if (record.isVerified === true) {
    return { record, userId, state: 'verified' as const };
  }
  const expiresAt: number | null = record.verifyTokenExpiresAt;
  if (!expiresAt || Date.now() > expiresAt) {
    return { record, userId, state: 'expired' as const };
  }
  return { record, userId, state: 'pending' as const };
}

function verifyErrorPayload(state: 'invalid' | 'expired') {
  if (state === 'expired') {
    return {
      code: 'EXPIRED',
      error: 'This verification link has expired. Request a new one below and it will arrive in a few seconds.',
    };
  }
  return {
    code: 'INVALID',
    error: 'This verification link is not valid. If you already confirmed your email, just sign in.',
  };
}

/**
 * GET /auth/verify-email?token=... — read-only status check.
 *
 * Deliberately does NOT activate the account. Mail clients, antivirus
 * scanners and chat apps all pre-fetch links in the background; a mutating
 * GET let them silently burn the token before the recipient ever clicked it.
 */
export async function handleCheckVerification(req: Request, res: Response) {
  try {
    const rawToken = typeof req.query.token === 'string' ? req.query.token : '';
    if (!rawToken) {
      return res.status(400).json({ success: false, code: 'MISSING', error: 'Missing verification token.' });
    }

    const { state } = await resolveVerifyToken(rawToken);

    if (state === 'pending') {
      return res.status(200).json({ success: true, valid: true, alreadyVerified: false, message: 'Link is valid. Confirming your email...' });
    }
    if (state === 'verified') {
      return res.status(200).json({ success: true, valid: true, alreadyVerified: true, message: 'Your email is already verified. You can sign in.' });
    }
    return res.status(400).json({ success: false, valid: false, ...verifyErrorPayload(state) });
  } catch (e: any) {
    console.error('Email verification check error:', e);
    return res.status(500).json({ success: false, error: 'Internal server error checking verification link' });
  }
}

/**
 * POST /auth/verify-email  body: { token }
 * Activates the account. Safe to retry: confirming an already-confirmed
 * address returns success instead of an error, so a double-tap, a back
 * button, or a scanner that slipped through never dead-ends the user.
 */
export async function handleVerifyEmail(req: Request, res: Response) {
  try {
    const rawToken = (typeof req.body?.token === 'string' ? req.body.token
      : typeof req.query.token === 'string' ? req.query.token : '').trim();
    if (!rawToken) {
      return res.status(400).json({ success: false, code: 'MISSING', error: 'Missing verification token.' });
    }

    const { record, userId, state } = await resolveVerifyToken(rawToken);

    if (state === 'invalid' || state === 'expired') {
      return res.status(400).json({ success: false, valid: false, ...verifyErrorPayload(state) });
    }

    if (state === 'verified') {
      return res.status(200).json({ success: true, alreadyVerified: true, message: 'Your email is already verified. You can sign in.' });
    }

    await db.markEmailVerified(userId);
    await db.logAudit(
      userId, record!.name, record!.email,
      'EMAIL_VERIFIED',
      'Email address confirmed via verification token.',
      undefined, req.ip
    );

    return res.status(200).json({ success: true, alreadyVerified: false, message: 'Email verified successfully. You can now sign in.' });
  } catch (e: any) {
    console.error('Email verification error:', e);
    return res.status(500).json({ success: false, error: 'Internal server error verifying email' });
  }
}

/**
 * POST /auth/resend-verification — re-issues a link for an unverified account.
 * Responds identically whether or not the account exists / is already verified,
 * so it cannot be used to enumerate registered addresses.
 */
export async function handleResendVerification(req: Request, res: Response) {
  try {
    const genericMessage = 'If an unverified account exists for that email, a new verification link has been sent.';

    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, error: 'A valid email address is required.' });
    }

    const user = await db.getUserByEmail(email);
    if (!user || user.blocked || user.isVerified === true) {
      return res.status(200).json({ success: true, message: genericMessage });
    }

    const origin = resolvePublicOrigin(req);
    const { emailed, verificationUrl } = await issueVerificationLink(
      { id: user.id, name: user.name, email: user.email },
      origin
    );

    await db.logAudit(
      user.id, user.name, user.email,
      'VERIFICATION_RESENT',
      'Email verification link re-issued.',
      undefined, req.ip
    );

    return res.status(200).json({
      success: true,
      message: genericMessage,
      emailSent: emailed,
      ...(process.env.NODE_ENV !== 'production' || !emailed
        ? { verificationUrl, dev: process.env.NODE_ENV !== 'production', mailFailed: !emailed }
        : {}),
    });
  } catch (e: any) {
    console.error('Resend verification error:', e);
    return res.status(500).json({ success: false, error: 'Internal server error resending verification email' });
  }
}

