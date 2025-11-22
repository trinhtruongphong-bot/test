import express from "express";
import multer from "multer";
import AdmZip from "adm-zip";
import cors from "cors";
import fs from "fs";

const app = express();

// Allow frontend + API same domain
app.use(cors());

// Serve HTML, CSS, JS from public/
app.use(express.static("public"));

let successCount = 0;

// Upload temp folder
const upload = multer({ dest: "uploads/" });

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    uptime_seconds: process.uptime(),
    version: "1.0.0"
  });
});

// Metrics
app.get("/metrics", (req, res) => {
  res.json({ success_count: successCount });
});

// Main bypass API
app.post(
  "/bypass/file",
  upload.fields([
    { name: "mobileprovision", maxCount: 1 },
    { name: "p12", maxCount: 1 }
  ]),
  async (req, res) => {
    try {
      const mp = req.files["mobileprovision"]?.[0];
      const p12 = req.files["p12"]?.[0];
      const password = req.body.password || "";

      if (!mp || !p12 || !password)
        return res.status(400).json({ error: "Missing file or password" });

      const zip = new AdmZip();

      zip.addLocalFile(mp.path, "", "profile.mobileprovision");
      zip.addLocalFile(p12.path, "", "certificate.p12");
      zip.addFile("password.txt", Buffer.from(password));

      const buffer = zip.toBuffer();

      fs.unlinkSync(mp.path);
      fs.unlinkSync(p12.path);

      successCount++;

      res.set({
        "Content-Type": "application/zip",
        "Content-Disposition": "attachment; filename=package.zip"
      });

      return res.send(buffer);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Internal Server Error" });
    }
  }
);

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("PPQCheck server running on port", port));
