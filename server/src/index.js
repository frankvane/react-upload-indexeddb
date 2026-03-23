const app = require("./app");
const { ensureBaseDirs } = require("./config/paths");
const { syncModels } = require("./models");

const PORT = Number.parseInt(process.env.PORT || "3000", 10);

const bootstrap = async () => {
  ensureBaseDirs();
  await syncModels();

  return app.listen(PORT, () => {
    console.log(`[server] listening on http://localhost:${PORT}`);
  });
};

if (require.main === module) {
  bootstrap().catch((error) => {
    console.error("[server] failed to start", error);
    process.exit(1);
  });
}

module.exports = {
  bootstrap,
};
