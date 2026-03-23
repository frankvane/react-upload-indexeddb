const express = require("express");
const uploadController = require("../controllers/uploadController");
const downloadController = require("../controllers/downloadController");
const { uploadChunk } = require("../middleware/uploadChunk");

const router = express.Router();

router.post("/instant", uploadController.instantCheck);
router.get("/status", uploadController.statusQuery);
router.post("/upload", uploadChunk, uploadController.uploadChunk);
router.post("/merge", uploadController.mergeChunks);

router.get("/list", downloadController.getFileList);
router.get("/download/:file_id", downloadController.downloadFile);

module.exports = router;
