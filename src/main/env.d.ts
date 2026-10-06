/// <reference types="electron-vite/node" />

// Text files inlined at build time (Redoc bundle for OpenAPI HTML exports).
declare module '*?raw' {
  const content: string
  export default content
}
