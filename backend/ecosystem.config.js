/**
 * PM2 runtime contract.
 *
 * Runtime secrets/config are injected from .env by the deployment environment;
 * this file contains no credentials. The server emits `ready` only after
 * configuration, DB/schema, provider and optional-cache initialization.
 */
module.exports = {
  apps: [
    {
      name: "music-backend",
      script: "dist/server.js",
      instances: "max",
      exec_mode: "cluster",
      env: {
        NODE_ENV: "production",
        PORT: 8000,
      },
      env_file: ".env",
      watch: false,
      max_memory_restart: "512M",
      error_file: "logs/pm2-error.log",
      out_file: "logs/pm2-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      restart_delay: 3000,
      max_restarts: 10,
      min_uptime: "10s",
      kill_timeout: 12000,
      wait_ready: true,
      listen_timeout: 20000,
    },
  ],
};
