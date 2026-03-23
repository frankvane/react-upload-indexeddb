const multer = require("multer");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024,
  },
});

const uploadChunk = upload.single("chunk");

module.exports = {
  uploadChunk,
};
