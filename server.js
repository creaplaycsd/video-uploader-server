require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const axios = require('axios');
const bodyParser = require('body-parser');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

// Google OAuth2 Client
const oAuth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  process.env.REDIRECT_URI
);
oAuth2Client.setCredentials({ refresh_token: process.env.REFRESH_TOKEN });

// Health check
app.get('/', (req, res) => {
  res.send('Video Uploader Server is running!');
});

/**
 * Create resumable upload session
 */
app.post('/create-upload-session', async (req, res) => {
  try {
    const { filename, mimeType, folderId } = req.body;
    if (!filename || !folderId) {
      return res.status(400).json({ error: 'filename and folderId are required.' });
    }

    // Get fresh token
    const { token } = await oAuth2Client.getAccessToken();
    if (!token) throw new Error('Failed to retrieve access token');

    // Create resumable upload session
    const sessionResponse = await axios.post(
      `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable`,
      { name: filename, parents: [folderId] },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json; charset=UTF-8',
        },
      }
    );

    const uploadUrl = sessionResponse.headers['location'];
    return res.json({ uploadUrl, accessToken: token });
  } catch (err) {
    console.error('Error creating upload session:', err.response?.data || err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(port, () => {
  console.log(`Server started at http://localhost:${port}`);
});
