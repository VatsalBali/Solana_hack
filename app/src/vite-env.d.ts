/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_RPC_URL?: string
  readonly VITE_MINT: string
  readonly VITE_TENANT_SECRET: string
  readonly VITE_LANDLORD_SECRET: string
  readonly VITE_MEDIATOR_SECRET: string
}
