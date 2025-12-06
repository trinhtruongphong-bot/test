const express = require("express");
const multer = require("multer");
const axios = require("axios");
const AdmZip = require("adm-zip");
const plist = require("plist");
const fs = require("fs");
const cors = require("cors");
const path = require("path");

const app = express();
const upload = multer({ dest: "uploads/" });

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const GITEA_URL = process.env.GITEA_URL;
const GITEA_OWNER = process.env.GITEA_OWNER;
const GITEA_REPO = process.env.GITEA_REPO;
const GITEA_TOKEN = process.env.GITEA_TOKEN;

function readIPA(filePath) {
    const zip = new AdmZip(filePath);
    const entries = zip.getEntries();

    let infoPlist = null;
    let appIcon = null;

    for (let entry of entries) {
        if (entry.entryName.includes("Info.plist")) {
            infoPlist = plist.parse(entry.getData().toString());
        }

        if (entry.entryName.match(/AppIcon.*60.*\.png$/)) {
            appIcon = entry.getData();
        }
    }

    return {
        appName: infoPlist?.CFBundleName || "Unknown",
        bundleId: infoPlist?.CFBundleIdentifier || "unknown.bundle",
        version: infoPlist?.CFBundleShortVersionString || "1.0",
        build: infoPlist?.CFBundleVersion || "1",
        icon: appIcon
    };
}

async function uploadToGitea(path, message, base64) {
    return axios.put(
        `${GITEA_URL}/api/v1/repos/${GITEA_OWNER}/${GITEA_REPO}/contents/${path}`,
        { message, content: base64 },
        { headers: { Authorization: `token ${GITEA_TOKEN}` } }
    );
}

app.post("/upload", upload.single("ipa"), async (req, res) => {
    try {
        const ipaPath = req.file.path;
        const fileName = req.file.originalname;

        const meta = readIPA(ipaPath);

        let iconUrl = null;
        if (meta.icon) {
            const iconName = fileName.replace(".ipa", ".png");
            const iconPath = path.join("public/icons", iconName);
            fs.writeFileSync(iconPath, meta.icon);
            iconUrl = `/icons/${iconName}`;
        }

        const ipaBase64 = fs.readFileSync(ipaPath).toString("base64");
        const ipaUpload = await uploadToGitea(`iPA/${fileName}`, `Upload IPA ${fileName}`, ipaBase64);
        const ipaUrl = ipaUpload.data.download_url;

        const plistName = fileName.replace(".ipa", ".plist");
        const plistContent = plist.build({
            items: [{
                assets: [{ kind: "software-package", url: ipaUrl }],
                metadata: {
                    "bundle-identifier": meta.bundleId,
                    "bundle-version": meta.version,
                    kind: "software",
                    title: meta.appName
                }
            }]
        });

        const plistBase64 = Buffer.from(plistContent).toString("base64");
        const plistUpload = await uploadToGitea(`Plist/${plistName}`, `Upload plist ${plistName}`, plistBase64);
        const plistUrl = plistUpload.data.download_url;

        const installLink =
            `itms-services://?action=download-manifest&url=${encodeURIComponent(plistUrl)}`;

        fs.unlinkSync(ipaPath);

        res.json({
            status: "success",
            meta,
            ipa: ipaUrl,
            plist: plistUrl,
            install: installLink,
            icon: iconUrl
        });

    } catch (err) {
        console.error(err);
        res.json({ error: "Upload failed" });
    }
});

app.get("/list", async (req, res) => {
    try {
        const url = `${GITEA_URL}/api/v1/repos/${GITEA_OWNER}/${GITEA_REPO}/contents/iPA`;
        console.log("Fetching:", url);

        const r = await axios.get(url, {
            headers: { Authorization: `token ${GITEA_TOKEN}` }
        });

        const files = r.data
            .filter(f => f.name.endsWith(".ipa"))
            .map(f => {
                const plistRaw =
                    `${GITEA_URL}/api/v1/repos/${GITEA_OWNER}/${GITEA_REPO}/raw/Plist/${f.name.replace(".ipa",".plist")}`;

                return {
                    name: f.name,
                    url: f.download_url,
                    icon: `/icons/${f.name.replace(".ipa", ".png")}`,
                    install: `itms-services://?action=download-manifest&url=${encodeURIComponent(plistRaw)}`
                };
            });

        res.json(files);

    } catch (err) {
        console.log("LIST ERROR:", err.response?.data || err.message);
        res.json([]);
    }
});

        res.json(files);

    } catch (err) {
        res.json([]);
    }
});

app.listen(process.env.PORT || 3000, () =>
    console.log("Server running on Render...")
);
