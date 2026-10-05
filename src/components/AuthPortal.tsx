import React, { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import {
  LogIn, UserPlus, Eye, EyeOff, ShieldAlert, Cpu, Zap, Compass,
  Terminal, Sparkles, KeyRound, MailCheck, ArrowLeft, ShieldCheck,
  CheckCircle2, ExternalLink, Copy, Check
} from 'lucide-react';
import { MindMark, BRAND } from '../brand';
import ThemeSwitcher from './ThemeSwitcher';
import { CollabIllustration } from './CollabIllustration';

type AuthView = 'login' | 'register' | 'forgot' | 'reset' | 'reset-done' | 'verify';

const REMEMBER_KEY = 'mindsync-remember';
const REMEMBERED_EMAIL_KEY = 'mindsync-remembered-email';

/**
 * MindSync authentication portal -- a warm, two-column sign-in page.
 * Self-contained: pulls auth actions straight from the store.
 */
export default function AuthPortal() {
  const {
    login, register, authError, clearAuthError,
    navigateTo, requestPasswordReset, resetPassword,
    pendingVerificationEmail, pendingVerificationUrl,
    verifyEmail, resendVerification, setPendingVerification,
  } = useStore();

  // Decide the initial view: a reset link lands on /reset-password?token=...,
  // a verification link lands on /verify-email?token=...
  const [view, setView] = useState<AuthView>(() => {
    if (typeof window !== 'undefined') {
      if (window.location.pathname === '/reset-password') return 'reset';
      if (window.location.pathname === '/verify-email') return 'verify';
    }
    return 'login';
  });
  const [resetToken] = useState<string>(() =>
    typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('token') || '' : ''
  );
  const [verifyToken] = useState<string>(() =>
    typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('token') || '' : ''
  );

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [name, setName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [devResetUrl, setDevResetUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Email verification state
  const [verifyState, setVerifyState] = useState<'idle' | 'working' | 'success' | 'error'>('idle');
  const [verifyMessage, setVerifyMessage] = useState<string | null>(null);
  const [resendState, setResendState] = useState<'idle' | 'working' | 'sent'>('idle');
  const [devVerifyUrl, setDevVerifyUrl] = useState<string | null>(null);
  // Distinguishes "dev mode" from "mail delivery really failed" in the fallback panel.
  const [mailFailed, setMailFailed] = useState(false);

  // Restore "remember me" email on mount
  useEffect(() => {
    try {
      // Fall back to the legacy `collabz-*` keys so returning users keep
      // their remembered email through the MindSync rebrand.
      const flag = localStorage.getItem(REMEMBER_KEY) === '1' || localStorage.getItem('collabz-remember') === '1';
      setRemember(flag);
      if (flag) {
        setEmail(localStorage.getItem(REMEMBERED_EMAIL_KEY) || localStorage.getItem('collabz-remembered-email') || '');
      }
    } catch {
      /* localStorage unavailable */
    }
  }, []);

  // Landing on /verify-email?token=... consumes the token immediately. When there is
  // no token we are on the post-signup "check your inbox" screen instead, so the
  // effect stays inert and lets the user resend.
  const arrivedViaVerifyLink = useRef(
    typeof window !== 'undefined' && window.location.pathname === '/verify-email'
  );

  useEffect(() => {
    if (view !== 'verify') return;
    if (!verifyToken) {
      if (arrivedViaVerifyLink.current) {
        setVerifyState('error');
        setVerifyMessage('This verification link is missing its token. Request a new one below.');
      }
      return;
    }
    let cancelled = false;
    (async () => {
      setVerifyState('working');
      const result = await verifyEmail(verifyToken);
      if (cancelled) return;
      setVerifyState(result.success ? 'success' : 'error');
      setVerifyMessage(result.message);
    })();
    return () => { cancelled = true; };
  }, [view, verifyToken, verifyEmail]);

  // Once the email is confirmed, send the user straight to the sign-in page
  // rather than leaving them on a success screen they have to click out of.
  // A short delay keeps the "Email verified" confirmation visible before the
  // navigation, so the change of page reads as deliberate rather than a flicker.
  useEffect(() => {
    if (view !== 'verify' || verifyState !== 'success') return;
    const timer = setTimeout(() => {
      setPendingVerification(null);
      switchView('login');
      navigateTo('/login');
    }, 1200);
    return () => clearTimeout(timer);
    // switchView/navigateTo are stable store actions; verifyState is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, verifyState]);

  const handleResendVerification = async (e: React.FormEvent) => {
    e.preventDefault();
    const target = email.trim() || pendingVerificationEmail;
    if (!target) return;
    setResendState('working');
    const result = await resendVerification(target);
    if (result.success) {
      setResendState('sent');
      setDevVerifyUrl(result.verificationUrl || null);
      setMailFailed(!!result.mailFailed);
    } else {
      setResendState('idle');
      setVerifyMessage(result.message);
    }
  };

  const persistRememberedEmail = (value: string) => {
    try {
      if (remember) {
        localStorage.setItem(REMEMBERED_EMAIL_KEY, value);
      } else {
        localStorage.removeItem(REMEMBERED_EMAIL_KEY);
      }
    } catch {
      /* ignore */
    }
  };

  const handleToggleRemember = (checked: boolean) => {
    setRemember(checked);
    try {
      localStorage.setItem(REMEMBER_KEY, checked ? '1' : '0');
      if (checked) {
        localStorage.setItem(REMEMBERED_EMAIL_KEY, email);
      } else {
        localStorage.removeItem(REMEMBERED_EMAIL_KEY);
      }
    } catch {
      /* ignore */
    }
  };

  const switchView = (next: AuthView) => {
    setView(next);
    setValidationError(null);
    setStatusMessage(null);
    setDevResetUrl(null);
    setCopied(false);
    clearAuthError();
  };

  // Copy the dev recovery link to the clipboard with transient feedback
  const copyResetLink = async () => {
    if (!devResetUrl) return;
    try {
      await navigator.clipboard.writeText(devResetUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard may be unavailable (insecure context) -- fall back to a selection prompt
      window.prompt('Copy this link:', devResetUrl);
    }
  };

  const goToLogin = () => {
    switchView('login');
    setPendingVerification(null);
    navigateTo('/login');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);
    clearAuthError();

    if (!email || !password) {
      setValidationError('Please populate all login input fields.');
      return;
    }
    if (view === 'register' && !name) {
      setValidationError('Please enter your full name.');
      return;
    }
    if (password.length < 6) {
      setValidationError('Password must contain at least 6 characters.');
      return;
    }

    persistRememberedEmail(email);
    setIsSubmitting(true);
    try {
      if (view === 'register') {
        const result = await register(name.trim(), email.trim(), password);
        // Signup never returns a session: land on the "verification mail sent"
        // page so the user can confirm before signing in. The URL must move to
        // /verify-email too, otherwise a refresh drops them back on /register.
        if (result.success) {
          setDevVerifyUrl(result.verificationUrl || pendingVerificationUrl || null);
          // Reflect the real delivery status: "mail sent, check your inbox" when
          // it left, and the manual-link panel only when it genuinely failed.
          setMailFailed(!!result.mailFailed);
          switchView('verify');
          navigateTo('/verify-email');
        }
      } else {
        const ok = await login(email.trim(), password);
        if (ok) {
          // Land on the workspace hub, not a room. The URL must move too,
          // otherwise the address bar keeps saying /login.
          navigateTo('/workspaces');
        }
      }
    } catch (err: any) {
      setValidationError(err.message || 'Verification routing failed. Try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);
    clearAuthError();

    if (!email) {
      setValidationError('Please enter your account email address.');
      return;
    }

    setIsSubmitting(true);
    try {
      persistRememberedEmail(email);
      const result = await requestPasswordReset(email.trim());
      setStatusMessage(result.message);
      setDevResetUrl(result.resetUrl || null);
    } catch (err: any) {
      setValidationError(err.message || 'Reset request failed. Try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);
    clearAuthError();

    if (!password || !confirmPassword) {
      setValidationError('Please fill in both password fields.');
      return;
    }
    if (password.length < 6) {
      setValidationError('Password must contain at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setValidationError('Passwords do not match.');
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await resetPassword(resetToken, password);
      if (result.success) {
        setStatusMessage(result.message);
        switchView('reset-done');
      } else {
        setValidationError(result.message);
      }
    } catch (err: any) {
      setValidationError(err.message || 'Password reset failed. Try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // -- Card content per view ---------------------------------------------
  const renderCardBody = () => {
    switch (view) {
      case 'forgot':
        return (
          <>
            <div className="text-center mb-5">
              <div className="w-11 h-11 rounded-xl bg-ember/10 border border-ember/20 flex items-center justify-center text-ember mx-auto mb-3">
                <KeyRound size={18} />
              </div>
              <h2 className="text-base font-semibold text-cream tracking-tight">Forgot your password?</h2>
              <p className="text-[14px] text-faint mt-1.5 leading-normal">
                Enter the email tied to your {BRAND.name} account and we'll send a recovery link.
              </p>
            </div>

            {statusMessage && (
              <div className="space-y-3 mb-5 animate-fadeIn">
                <div className="bg-leaf/5 border border-leaf/25 text-leaf rounded-lg px-3 py-2.5 text-[13px] flex items-start gap-2">
                  <MailCheck size={14} className="shrink-0 mt-0.5" />
                  <p>{statusMessage}</p>
                </div>

                {devResetUrl && (
                  <div className="rounded-xl border border-ember/30 bg-ember/5 p-3 space-y-2.5">
                    <div className="flex items-center gap-1.5 text-[13px] font-mono font-bold uppercase tracking-widest text-ember">
                      <Terminal size={11} />
                      Dev mode &mdash; recovery link
                    </div>
                    <p className="text-[13px] text-sand leading-relaxed">
                      No mail server is configured, so the link is shown here instead of being emailed. It expires in 1 hour.
                    </p>
                    <div className="flex items-center gap-1.5 bg-ink/60 border border-line rounded-lg px-2 py-1.5">
                      <span
                        className="text-[13px] font-mono text-faint truncate flex-1 select-all"
                        title={devResetUrl}
                      >
                        {devResetUrl}
                      </span>
                      <button
                        type="button"
                        onClick={copyResetLink}
                        className="shrink-0 p-1 rounded text-faint hover:text-cream hover:bg-panel-2 transition-colors cursor-pointer"
                        title="Copy link"
                      >
                        {copied ? <Check size={12} className="text-leaf" /> : <Copy size={12} />}
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => { window.location.href = devResetUrl; }}
                      className="w-full inline-flex items-center justify-center gap-1.5 py-2 bg-ember hover:bg-ember-2 text-on-ember font-bold text-[13px] rounded-lg transition-colors shadow-md shadow-ember/20 cursor-pointer"
                    >
                      <ExternalLink size={12} />
                      <span>Open recovery link</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {(validationError || authError) && (
              <div className="bg-rust/5 border border-rust/20 text-rust rounded-lg px-3 py-2.5 text-[13px] flex items-start gap-2 mb-5 animate-shake">
                <ShieldAlert size={14} className="shrink-0 mt-0.5" />
                <p>{validationError || authError}</p>
              </div>
            )}

            <form onSubmit={handleForgotSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="forgot-email" className="text-[14px] uppercase tracking-wider font-semibold text-sand block font-mono">Email Address</label>
                <input
                  id="forgot-email"
                  type="email"
                  required
                  placeholder="name@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-ink/60 border border-line rounded-xl px-4 py-3 text-[15px] text-cream placeholder-faint focus:outline-none focus:border-ember/60 focus:ring-2 focus:ring-ember/10 transition-all"
                />
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-3 mt-2 bg-ember hover:bg-ember-2 text-on-ember font-bold text-[15px] rounded-2xl transition-colors shadow-md shadow-ember/20 cursor-pointer flex items-center justify-center gap-1.5 btn-3d disabled:opacity-60 disabled:cursor-wait"
              >
                <MailCheck size={14} />
                <span>{isSubmitting ? 'Sending\u2026' : 'Send Recovery Link'}</span>
              </button>
            </form>

            <div className="mt-5 border-t border-line pt-4 text-center text-[13px]">
              <button
                type="button"
                onClick={goToLogin}
                className="text-ember hover:text-ember-soft font-semibold cursor-pointer underline underline-offset-2 transition-colors inline-flex items-center gap-1"
              >
                <ArrowLeft size={11} />
                <span>Back to sign in</span>
              </button>
            </div>
          </>
        );

      case 'reset':
        return (
          <>
            <div className="text-center mb-5">
              <div className="w-11 h-11 rounded-xl bg-ember/10 border border-ember/20 flex items-center justify-center text-ember mx-auto mb-3">
                <KeyRound size={18} />
              </div>
              <h2 className="text-base font-semibold text-cream tracking-tight">Choose a new password</h2>
              <p className="text-[14px] text-faint mt-1.5 leading-normal">
                Pick a strong password &mdash; at least 6 characters.
              </p>
            </div>

            {!resetToken && (
              <div className="bg-rust/5 border border-rust/20 text-rust rounded-lg px-3 py-2.5 text-[13px] flex items-start gap-2 mb-5">
                <ShieldAlert size={14} className="shrink-0 mt-0.5" />
                <p>This recovery link is missing a token. Request a new one from the sign-in page.</p>
              </div>
            )}

            {(validationError || authError) && (
              <div className="bg-rust/5 border border-rust/20 text-rust rounded-lg px-3 py-2.5 text-[13px] flex items-start gap-2 mb-5 animate-shake">
                <ShieldAlert size={14} className="shrink-0 mt-0.5" />
                <p>{validationError || authError}</p>
              </div>
            )}

            {resetToken && (
              <form onSubmit={handleResetSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <label htmlFor="new-password" className="text-[14px] uppercase tracking-wider font-semibold text-sand block font-mono">New Password</label>
                  <div className="relative">
                    <input
                      id="new-password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      placeholder={'\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full bg-ink/60 border border-line rounded-xl pl-4 pr-11 py-3 text-[15px] text-cream placeholder-faint focus:outline-none focus:border-ember/60 focus:ring-2 focus:ring-ember/10 transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-faint hover:text-cream transition-colors cursor-pointer"
                    >
                      {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="confirm-password" className="text-[14px] uppercase tracking-wider font-semibold text-sand block font-mono">Confirm New Password</label>
                  <input
                    id="confirm-password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    placeholder={'\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full bg-ink/60 border border-line rounded-xl px-4 py-3 text-[15px] text-cream placeholder-faint focus:outline-none focus:border-ember/60 focus:ring-2 focus:ring-ember/10 transition-all"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-3 mt-2 bg-ember hover:bg-ember-2 text-on-ember font-bold text-[15px] rounded-2xl transition-colors shadow-md shadow-ember/20 cursor-pointer flex items-center justify-center gap-1.5 btn-3d disabled:opacity-60 disabled:cursor-wait"
                >
                  <CheckCircle2 size={14} />
                  <span>{isSubmitting ? 'Updating\u2026' : 'Update Password'}</span>
                </button>
              </form>
            )}

            <div className="mt-5 border-t border-line pt-4 text-center text-[13px]">
              <button
                type="button"
                onClick={goToLogin}
                className="text-ember hover:text-ember-soft font-semibold cursor-pointer underline underline-offset-2 transition-colors inline-flex items-center gap-1"
              >
                <ArrowLeft size={11} />
                <span>Back to sign in</span>
              </button>
            </div>
          </>
        );

      case 'reset-done':
        return (
          <>
            <div className="text-center py-2">
              <div className="w-14 h-14 rounded-2xl bg-leaf/10 border border-leaf/25 flex items-center justify-center text-leaf mx-auto mb-4 animate-fadeInScale">
                <CheckCircle2 size={26} />
              </div>
              <h2 className="text-base font-semibold text-cream tracking-tight">Password updated</h2>
              {statusMessage && (
                <p className="text-[14px] text-faint mt-1.5 leading-normal">{statusMessage}</p>
              )}
            </div>

            <button
              type="button"
              onClick={goToLogin}
              className="w-full py-3 mt-5 bg-ember hover:bg-ember-2 text-on-ember font-bold text-[15px] rounded-2xl transition-colors shadow-md shadow-ember/20 cursor-pointer flex items-center justify-center gap-1.5 btn-3d"
            >
              <LogIn size={14} />
              <span>Sign in with new password</span>
            </button>
          </>
        );

      case 'verify':
        return (
          <>
            <div className="text-center py-2">
              <div
                className={`w-14 h-14 rounded-2xl border flex items-center justify-center mx-auto mb-4 animate-fadeInScale ${
                  verifyState === 'success'
                    ? 'bg-leaf/10 border-leaf/25 text-leaf'
                    : verifyState === 'error'
                      ? 'bg-rust/10 border-rust/25 text-rust'
                      : 'bg-ember/10 border-ember/25 text-ember'
                }`}
              >
                {verifyState === 'success' ? (
                  <CheckCircle2 size={26} />
                ) : verifyState === 'error' ? (
                  <ShieldAlert size={26} />
                ) : verifyState === 'working' ? (
                  <span className="w-6 h-6 rounded-full border-2 border-ember/25 border-t-ember animate-spin" />
                ) : (
                  <MailCheck size={26} />
                )}
              </div>

              <h2 className="text-base font-semibold text-cream tracking-tight">
                {verifyState === 'success'
                  ? 'Email verified'
                  : verifyState === 'error'
                    ? 'Verification failed'
                    : 'Verify your email'}
              </h2>

              <p className="text-[14px] text-faint mt-1.5 leading-normal">
                {verifyState === 'working'
                  ? 'Confirming your email address\u2026'
                  : verifyState === 'success'
                    ? 'Your account is active. You can sign in now.'
                    : verifyState === 'error'
                      ? verifyMessage || 'This link is no longer valid.'
                      : `We sent a confirmation link to ${pendingVerificationEmail || email || 'your inbox'}. Click it to activate your account.`}
              </p>
            </div>

            {devVerifyUrl && mailFailed && verifyState !== 'success' && (
              <div className="mt-4 bg-ember/5 border border-ember/20 rounded-lg p-3">
                <p className="text-[13px] font-mono font-bold uppercase tracking-wider text-ember-soft mb-2">
                  Email delivery failed — manual verification link
                </p>
                <p className="text-[12px] text-faint mb-2 leading-relaxed">
                  The mail server could not be reached, so the link was not emailed. Use it below to activate your account now.
                </p>
                <p className="text-[13px] text-faint mb-2 break-all">{devVerifyUrl}</p>
                <a
                  href={devVerifyUrl}
                  className="inline-flex items-center gap-1 text-[14px] font-semibold text-ember hover:underline"
                >
                  Open verification link <ExternalLink size={11} />
                </a>
              </div>
            )}

            {verifyState === 'success' ? (
              <button
                type="button"
                onClick={goToLogin}
                className="w-full py-3 mt-5 bg-ember hover:bg-ember-2 text-on-ember font-bold text-[15px] rounded-2xl transition-colors shadow-md shadow-ember/20 cursor-pointer flex items-center justify-center gap-1.5 btn-3d"
              >
                <LogIn size={14} />
                <span>Continue to sign in</span>
              </button>
            ) : (
              <>
                <form onSubmit={handleResendVerification} className="mt-5 space-y-2.5">
                  <label className="block text-[13px] font-mono font-bold uppercase tracking-widest text-faint">
                    Resend link
                  </label>
                  <input
                    type="email"
                    value={email || pendingVerificationEmail || ''}
                    onChange={(e) => { setEmail(e.target.value); setResendState('idle'); }}
                    placeholder="you@example.com"
                    className="w-full bg-ink border border-line rounded-xl px-4 py-3 text-[15px] text-cream placeholder-faint focus:outline-none focus:border-ember/50 focus:ring-2 focus:ring-ember/10 transition-all"
                  />
                  <button
                    type="submit"
                    disabled={resendState === 'working' || !(email || pendingVerificationEmail)}
                    className="w-full py-3 bg-panel-2 hover:bg-line text-sand text-[15px] font-bold rounded-2xl transition-colors cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {resendState === 'working' ? (
                      <span className="w-3.5 h-3.5 rounded-full border-2 border-line-2 border-t-ember animate-spin" />
                    ) : (
                      <MailCheck size={14} />
                    )}
                    <span>
                      {resendState === 'sent'
                        ? 'Link sent \u2014 check your inbox'
                        : resendState === 'working'
                          ? 'Sending\u2026'
                          : 'Send a new link'}
                    </span>
                  </button>
                </form>

                <button
                  type="button"
                  onClick={goToLogin}
                  className="w-full py-3 mt-3 text-faint hover:text-cream text-[14px] font-medium transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <ArrowLeft size={13} />
                  <span>Back to sign in</span>
                </button>
              </>
            )}
          </>
        );

      default:
        // login | register
        return (
          <>
            <div className="text-center mb-5">
              <h2 className="text-base font-semibold text-cream tracking-tight">
                {view === 'register' ? `Create your ${BRAND.name} account` : `Sign in to ${BRAND.name}`}
              </h2>
              <p className="text-[14px] text-faint mt-1.5 leading-normal">
                {view === 'register'
                  ? 'Join other system collaborators and access parallel streams.'
                  : 'Welcome back! Enter credentials to launch the dashboard.'}
              </p>
            </div>

            {view === 'login' && pendingVerificationEmail && (
              <div className="bg-ember/5 border border-ember/25 rounded-lg px-3.5 py-3 text-[13px] mb-5 flex items-start gap-2.5">
                <MailCheck size={15} className="shrink-0 mt-0.5 text-ember" />
                <div className="min-w-0">
                  <p className="text-sand font-semibold leading-snug">Verify your email first, then sign in.</p>
                  <p className="text-faint leading-relaxed mt-1">
                    We sent a confirmation link to <span className="text-sand font-medium break-all">{pendingVerificationEmail}</span>.
                    {' '}Your account stays locked until that link is opened.
                  </p>
                  {pendingVerificationUrl && verifyState !== 'success' && (
                    <a
                      href={pendingVerificationUrl}
                      className="inline-flex items-center gap-1 text-ember hover:underline font-semibold mt-2"
                    >
                      Open the verification link <ExternalLink size={11} />
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => { setEmail(pendingVerificationEmail || email); switchView('verify'); }}
                    className="block text-ember hover:underline font-semibold mt-1.5 cursor-pointer"
                  >
                    Didn&rsquo;t get it? Send a new link
                  </button>
                </div>
              </div>
            )}

            {(validationError || authError) && (
              <div className="bg-rust/5 border border-rust/20 text-rust rounded-lg px-3 py-2.5 text-[13px] flex items-start gap-2 mb-5 animate-shake">
                <ShieldAlert size={14} className="shrink-0 mt-0.5" />
                <p>{validationError || authError}</p>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {view === 'register' && (
                <div className="space-y-1.5">
                  <label htmlFor="name-input" className="text-[14px] uppercase tracking-wider font-semibold text-sand block font-mono">Full Name</label>
                  <input
                    id="name-input"
                    type="text"
                    required
                    placeholder="Sarah Connor"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full bg-ink/60 border border-line rounded-xl px-4 py-3 text-[15px] text-cream placeholder-faint focus:outline-none focus:border-ember/60 focus:ring-2 focus:ring-ember/10 transition-all"
                  />
                </div>
              )}

              <div className="space-y-1.5">
                <label htmlFor="email-input" className="text-[14px] uppercase tracking-wider font-semibold text-sand block font-mono">Email Address</label>
                <input
                  id="email-input"
                  type="email"
                  required
                  placeholder="name@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-ink/60 border border-line rounded-xl px-4 py-3 text-[15px] text-cream placeholder-faint focus:outline-none focus:border-ember/60 focus:ring-2 focus:ring-ember/10 transition-all"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="password-input" className="text-[14px] uppercase tracking-wider font-semibold text-sand block font-mono">Secret Password</label>
                <div className="relative">
                  <input
                    id="password-input"
                    type={showPassword ? 'text' : 'password'}
                    required
                    placeholder={'\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-ink/60 border border-line rounded-xl pl-4 pr-11 py-3 text-[15px] text-cream placeholder-faint focus:outline-none focus:border-ember/60 focus:ring-2 focus:ring-ember/10 transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-faint hover:text-cream transition-colors cursor-pointer"
                  >
                    {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>

              {/* Remember me + Forgot password */}
              <div className="flex items-center justify-between gap-2 -mt-1">
                <button
                  type="button"
                  onClick={() => handleToggleRemember(!remember)}
                  className="flex items-center gap-1.5 text-[14px] text-sand hover:text-cream transition-colors cursor-pointer group"
                >
                  <span className={`w-3.5 h-3.5 rounded-[5px] border flex items-center justify-center transition-all ${
                    remember
                      ? 'bg-ember border-ember text-on-ember'
                      : 'border-line-2 bg-ink/60 group-hover:border-ember/50'
                  }`}>
                    {remember && <CheckCircle2 size={10} strokeWidth={3} />}
                  </span>
                  <span>Remember me</span>
                </button>

                {view === 'login' && (
                  <button
                    type="button"
                    onClick={() => switchView('forgot')}
                    className="text-[14px] text-ember hover:text-ember-soft font-medium cursor-pointer transition-colors"
                  >
                    Forgot password?
                  </button>
                )}
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-3 mt-2 bg-ember hover:bg-ember-2 text-on-ember font-bold text-[15px] rounded-2xl transition-colors shadow-md shadow-ember/20 cursor-pointer flex items-center justify-center gap-1.5 btn-3d disabled:opacity-60 disabled:cursor-wait"
              >
                {view === 'register' ? <UserPlus size={14} /> : <LogIn size={14} />}
                <span>{view === 'register' ? 'Register Account' : 'Authenticate Session'}</span>
              </button>
            </form>

            <div className="mt-5 border-t border-line pt-4 text-center text-[13px]">
              <span className="text-faint">
                {view === 'register' ? 'Already registered on platform?' : 'First time running the system?'}
              </span>
              <button
                type="button"
                onClick={() => switchView(view === 'register' ? 'login' : 'register')}
                className="text-ember hover:text-ember-soft ml-1.5 font-semibold cursor-pointer underline underline-offset-2 transition-colors"
              >
                {view === 'register' ? 'Verify Account instead' : 'Build a system profile'}
              </button>
            </div>
          </>
        );
    }
  };

  return (
    <main className="relative min-h-screen bg-ink font-sans text-sand grain overflow-hidden">
      {/* One gentle warm wash instead of three blurred 700px orbs */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 -right-32 h-[30rem] w-[30rem] rounded-full opacity-[0.07]"
        style={{ background: 'radial-gradient(circle, var(--color-ember) 0%, transparent 65%)' }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-[-10rem] -left-40 h-[26rem] w-[26rem] rounded-full opacity-[0.05]"
        style={{ background: 'radial-gradient(circle, var(--color-leaf) 0%, transparent 65%)' }}
      />

      {/* Theme switcher (visible on every screen) */}
      <ThemeSwitcher variant="floating" className="fixed top-5 right-5 z-50" />

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-6xl flex-col items-center gap-12 px-6 py-16 lg:flex-row lg:items-center lg:gap-20 lg:py-20">
        {/* -- Brand side ------------------------------------------- */}
        <section className="w-full max-w-lg text-center lg:max-w-none lg:flex-1 lg:text-left">
          <div className="mb-8 flex items-center justify-center gap-3 lg:justify-start">
            <MindMark size={38} />
            <span className="font-display text-2xl font-semibold tracking-tight text-cream">
              {BRAND.name}
            </span>
          </div>

          <span className="inline-flex items-center gap-2 rounded-full bg-ember/10 px-3.5 py-1.5 text-[13px] font-semibold uppercase tracking-wider text-ember">
            <Sparkles size={14} />
            Multi-model collaboration
          </span>

          <h1 className="mt-5 font-display text-4xl font-semibold leading-[1.1] tracking-tight text-cream md:text-5xl">
            Every AI model,
            <br />
            <span className="text-ember">one shared mind.</span>
          </h1>

          <p className="mx-auto mt-5 max-w-md text-lg leading-relaxed text-sand lg:mx-0">
            {BRAND.name} streams answers from every model side by side, so your team
            compares, refines, and pins the best output together.
          </p>

          <div className="mt-10 hidden justify-center lg:flex">
            <CollabIllustration className="w-full max-w-lg" />
          </div>
        </section>

        {/* -- Auth side -------------------------------------------- */}
        <section className="w-full lg:w-[27rem] lg:shrink-0">
          <div className="rounded-[1.75rem] border border-line bg-panel p-7 shadow-xl md:p-8">
            {renderCardBody()}
          </div>

          <ul className="mt-7 grid gap-3 text-[15px] text-sand">
            {[
              { icon: Cpu, text: 'Side-by-side model matrices' },
              { icon: Zap, text: 'Realtime Gemini streaming' },
              { icon: Compass, text: 'Collaborative cursor tracking' },
              { icon: Terminal, text: 'Persistent chat history' },
            ].map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ember/10">
                  <Icon size={15} className="text-ember" />
                </span>
                {text}
              </li>
            ))}
          </ul>

          <p className="mt-7 flex items-center justify-center gap-2 text-[13px] text-faint">
            <ShieldCheck size={14} />
            Secured with JWT &amp; bcrypt
          </p>
        </section>
      </div>
    </main>
  );
}

