require('dotenv').config({ path: __dirname + '/.env' });
const express = require('express');
const cors = require('cors');
app.use(cors());
const multer = require('multer');
const { google } = require('googleapis');
const fs = require('fs');
const axios = require('axios');
const path = require('path');

const app = express();
const port = 3000;

// Middleware
const upload = multer({ dest: 'uploads/' });

// Google OAuth2 Client
const oAuth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  process.env.REDIRECT_URI
);
oAuth2Client.setCredentials({ refresh_token: process.env.REFRESH_TOKEN });

// Debug environment variables
console.log('CLIENT_ID loaded:', !!process.env.CLIENT_ID);
console.log('REFRESH_TOKEN loaded:', !!process.env.REFRESH_TOKEN);

// Root route
app.get('/', (req, res) => {
  res.send('Video Uploader Server is running!');
});

// Upload route
app.post('/upload', upload.single('file'), async (req, res) => {
  console.log('POST /upload called');
  console.log('Request body:', req.body);
  console.log('Uploaded file:', req.file);

  if (!req.file) {
    console.log('No file uploaded');
    return res.status(400).json({ success: false, error: 'No file uploaded.' });
  }

  try {
    const { course, centre, batch, level, student } = req.body;
    const filePath = req.file.path;
    const fileName = req.file.originalname;

    console.log('Parsed fields:', { course, centre, batch, level, student });

    // 1. Get Folder ID from Apps Script
    const scriptUrl = `https://script.google.com/macros/s/AKfycbxydrQ8X_pTr77N8C1yOuJaXhopirPv0t0a1d1IQPSnHgvgGM_x2tDf_z3c_zUdybs/exec?course=${encodeURIComponent(course)}&centre=${encodeURIComponent(centre)}&batch=${encodeURIComponent(batch)}&level=${encodeURIComponent(level)}&student=${encodeURIComponent(student)}`;
    console.log('Fetching Folder ID from:', scriptUrl);

    const { data: folderId } = await axios.get(scriptUrl);
    console.log('Folder ID from Apps Script:', folderId);

    if (folderId === 'NOT_FOUND') {
      throw new Error('Folder ID not found for given details.');
    }

    // 2. Get Access Token
    const { token } = await oAuth2Client.getAccessToken();
    if (!token) throw new Error('Failed to retrieve access token');

    // 3. Start resumable upload session
    const fileSize = fs.statSync(filePath).size;
    const startSession = await axios.post(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable',
      { name: fileName, parents: [folderId] },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Length': fileSize,
          'X-Upload-Content-Type': 'application/octet-stream',
        },
      }
    );

    const uploadUrl = startSession.headers['location'];

    // 4. Upload the file
    const fileStream = fs.createReadStream(filePath);
    await axios.put(uploadUrl, fileStream, {
      headers: {
        'Content-Length': fileSize,
        'Content-Type': 'application/octet-stream',
      },
    });

    // 5. Delete local file
    fs.unlinkSync(filePath);

    res.json({ success: true, message: 'File uploaded successfully!' });
  } catch (err) {
    console.error('Upload failed:', err.response?.data || err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Start server
app.listen(port, () => {
  console.log(`Server started at http://localhost:${port}`);
});
