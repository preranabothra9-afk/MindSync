/**
 * MindSync — Brand Configuration
 * 
 * Central source of truth for all branding tokens, metadata, and SEO configuration.
 * Every visual surface in the application should reference these values.
 */

// ─── Brand Identity ────────────────────────────────────────────────────
export const BRAND = {
  name: 'MindSync',
  tagline: 'Real-Time AI Collaboration Platform',
  subtitle: 'Multi-Agent Sandbox',
  description: 'Real-time multi-model AI collaboration platform with parallel streaming, side-by-side comparative diagnostics, and enterprise-grade collaborative workspaces.',
  version: 'v2.4.0',
  author: 'MindSync Engineering',
  url: 'https://mindsync.dev',
} as const;

// ─── Page Title System ─────────────────────────────────────────────────
export const PAGE_TITLES: Record<string, string> = {
  '/': `${BRAND.name} - ${BRAND.tagline}`,
  '/workspaces': `Your Workspaces | ${BRAND.name}`,
  '/workspace': `Live Room | ${BRAND.name}`,
  '/login': `Login | ${BRAND.name}`,
  '/register': `Register | ${BRAND.name}`,
  '/reset-password': `Reset Password | ${BRAND.name}`,
  '/admin': `Admin Dashboard | ${BRAND.name}`,
  '/admin/dashboard': `Admin Dashboard | ${BRAND.name}`,
  '/admin/users': `User Management | ${BRAND.name}`,
  '/admin/workspaces': `Workspace Management | ${BRAND.name}`,
  '/admin/analytics': `Analytics | ${BRAND.name}`,
  '/admin/ai-monitoring': `AI Monitoring | ${BRAND.name}`,
  '/admin/audit-logs': `Audit Logs | ${BRAND.name}`,
  '/admin/settings': `Settings | ${BRAND.name}`,
} as const;

export const DEFAULT_TITLE = `${BRAND.name} — ${BRAND.tagline}`;

// ─── Brand Color System ──────────────────────────────────────────────
// Dual-mode: "Linen" (light) + "Obsidian" (dark). Indigo is the single accent.
export const COLORS = {
  // Core brand palette — restrained indigo ramp (the single accent)
  primary: {
    50: '#eef0ff',
    100: '#e0e3ff',
    200: '#c7d2fe',
    300: '#a5b4fc',
    400: '#818cf8',
    500: '#6366f1',  // Indigo-500 — soft accent
    600: '#4f46e5',  // Indigo-600 — primary brand color (light mode)
    700: '#4338ca',
    800: '#3730a3',
    900: '#312e81',
    950: '#1e1b4b',
  },
  // Neutral surface ramp — warm linen / stone (light mode surfaces)
  secondary: {
    50: '#faf9f7',
    100: '#f4f3f0',
    200: '#e7e5e0',
    300: '#d9d6cf',
    400: '#9c978c',
    500: '#6f6b63',  // muted text
    600: '#4f4c45',
    700: '#33322c',  // primary text
    800: '#26251f',
    900: '#1c1b16',
    950: '#0f0e0b',
  },
  // Dark-mode surface ramp — cool obsidian
  dark: {
    base: '#0a0b10',
    panel: '#12141b',
    panel2: '#1a1d26',
    line: '#262a35',
    line2: '#363c4a',
    text: '#f1f2f6',
    muted: '#a6abba',
    faint: '#6d7383',
  },
  accent: {
    purple: '#6366f1',
    violet: '#4f46e5',
    fuchsia: '#818cf8',
  },
  // Semantic colors (muted for light surfaces)
  success: '#16a34a',
  warning: '#d97706',
  destructive: '#dc2626',
  info: '#4f46e5',
  // Surface & background — warm linen (light-mode-first)
  surface: {
    base: '#faf9f7',
    elevated: '#ffffff',
    overlay: '#f4f3f0',
    subtle: '#e7e5e0',
  },
  // Chart / data visualization palette — indigo + neutrals
  chart: [
    '#4f46e5', // Indigo-600
    '#6366f1', // Indigo-500
    '#818cf8', // Indigo-400
    '#a5b4fc', // Indigo-300
    '#16a34a', // Green-600 (positive)
    '#dc2626', // Red-600 (negative)
    '#6b7186', // Neutral faint
    '#4c5266', // Neutral muted
  ],
} as const;

// ─── SEO & Meta Tags ───────────────────────────────────────────────────
export const SEO = {
  title: DEFAULT_TITLE,
  description: 'MindSync is a real-time multi-model AI collaboration platform. Stream responses from multiple AI models side-by-side, collaborate in shared workspaces, and gain enterprise-grade analytics — all in one unified interface.',
  keywords: [
    'AI collaboration',
    'multi-model AI',
    'real-time AI streaming',
    'AI SaaS platform',
    'collaborative AI workspace',
    'enterprise AI',
    'AI comparison tool',
    'parallel AI inference',
    'team AI workspace',
    'AI analytics dashboard',
  ].join(', '),
  robots: 'index, follow',
  themeColor: '#f6f7fb',
  themeColorDark: '#0e1017',
  // OpenGraph
  og: {
    type: 'website',
    title: `${BRAND.name} — ${BRAND.tagline}`,
    description: 'Stream, compare, and collaborate with multiple AI models in real-time. Enterprise-grade multi-model AI workspace for teams.',
    image: '/og-preview.png',
    url: BRAND.url,
    siteName: BRAND.name,
  },
  // Twitter Card
  twitter: {
    card: 'summary_large_image',
    title: `${BRAND.name} — ${BRAND.tagline}`,
    description: 'Real-time multi-model AI streaming, side-by-side comparison, and collaborative workspaces. Built for teams.',
    image: '/og-preview.png',
    site: '@mindsync',
  },
} as const;

// ─── PWA Manifest Configuration ────────────────────────────────────────
export const PWA = {
  name: `${BRAND.name} — ${BRAND.tagline}`,
  shortName: BRAND.name,
  description: BRAND.description,
  themeColor: '#ffffff',
  themeColorDark: '#0a0b10',
  backgroundColor: '#faf9f7',
  backgroundColorDark: '#0a0b10',
  display: 'standalone' as const,
  orientation: 'portrait' as const,
  startUrl: '/',
  scope: '/',
  icons: [
    { src: '/icons/icon-72.png', sizes: '72x72', type: 'image/png' },
    { src: '/icons/icon-96.png', sizes: '96x96', type: 'image/png' },
    { src: '/icons/icon-128.png', sizes: '128x128', type: 'image/png' },
    { src: '/icons/icon-144.png', sizes: '144x144', type: 'image/png' },
    { src: '/icons/icon-152.png', sizes: '152x152', type: 'image/png' },
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: '/icons/icon-384.png', sizes: '384x384', type: 'image/png' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
  ],
} as const;
