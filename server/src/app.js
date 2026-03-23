const cors = require("cors");
const express = require("express");
const morgan = require("morgan");
const fileRoutes = require("./routes/fileRoutes");

const app = express();

app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan(process.env.NODE_ENV === "test" ? "tiny" : "dev"));

app.get("/api/health", (_req, res) => {
  res.json({
    code: 200,
    message: "ok",
    data: {
      now: new Date().toISOString(),
    },
  });
});

app.use("/api/file", fileRoutes);

app.use((error, _req, res, _next) => {
  res.status(500).json({
    code: 500,
    message: error.message || "internal server error",
    data: {},
  });
});

module.exports = app;
