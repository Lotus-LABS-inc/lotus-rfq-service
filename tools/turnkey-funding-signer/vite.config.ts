import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const backendUrl = env.VITE_LOTUS_API_BASE_URL || "https://lotus-backend-g1e1.onrender.com";

  return {
    plugins: [react()],
    server: {
      host: "127.0.0.1",
      port: 5177,
      strictPort: true,
      proxy: {
        "/lotus-api": {
          target: backendUrl,
          changeOrigin: true,
          secure: true,
          rewrite: (path) => path.replace(/^\/lotus-api/, "")
        },
        "/lifi-api": {
          target: "https://li.quest",
          changeOrigin: true,
          secure: true,
          rewrite: (path) => path.replace(/^\/lifi-api/, "")
        }
      }
    }
  };
});
