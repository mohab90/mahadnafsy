/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ADMIN_EMAILS: string;
  readonly VITE_VIDEO_KEY: string;
  readonly VITE_API_URL: string;
  /** '1' shows the multi-institute (SaaS) setup screens. See lib/productMode.ts. */
  readonly VITE_SAAS_UI?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
