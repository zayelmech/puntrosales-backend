module.exports = {
  apps: [
    {
      name: "puntrosales-http-proxy",
      script: "src/server.js",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PORT: 8081
      }
    }
  ]
};
