import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Falha o build se houver erro de tipos ou de lint — guardrail proposital.
  // NÃO troque para `true`: silenciar esses erros deixa bugs passarem para produção.
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: false },
};

export default nextConfig;
