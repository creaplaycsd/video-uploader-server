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

// Google Drive API Client
const drive = google.drive({ version: 'v3', auth: oAuth2Client });

// Health check
app.get('/', (req, res) => {
    res.send('Video Uploader Server is running!');
});

/**
 * Helper function to find a folder ID by name and parent
 */
async function findFolderId(folderName, parentFolderId) {
    if (!parentFolderId) return null;
    const { token } = await oAuth2Client.getAccessToken();
    const res = await drive.files.list({
        q: `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and '${parentFolderId}' in parents and trashed=false`,
        fields: 'files(id)',
        spaces: 'drive',
    });
    return res.data.files.length > 0 ? res.data.files[0].id : null;
}

/**
 * Create resumable upload session for INDIVIDUAL upload
 */
app.post('/create-upload-session', async (req, res) => {
    try {
        const { filename, mimeType, course, centre, batch, level, studentName } = req.body;
        if (!filename || !studentName) {
            return res.status(400).json({ error: 'filename and studentName are required.' });
        }

        // Find the student's folder ID on the server
        const courseFolderId = await findFolderId(course, process.env.ROOT_FOLDER_ID);
        const centreFolderId = await findFolderId(centre, courseFolderId);
        const batchFolderId = await findFolderId(batch, centreFolderId);
        const levelFolderId = await findFolderId(level, batchFolderId);
        const folderId = await findFolderId(studentName, levelFolderId);

        if (!folderId) {
            return res.status(404).json({ error: `Folder for ${studentName} not found.` });
        }

        const { token } = await oAuth2Client.getAccessToken();
        if (!token) throw new Error('Failed to retrieve access token');

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
        return res.json({ uploadUrl, accessToken: token, fileId: sessionResponse.data.id });
    } catch (err) {
        console.error('Error creating upload session:', err.response?.data || err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * Create resumable upload session for GROUP upload
 */
app.post('/create-group-upload-session', async (req, res) => {
    try {
        const { filename, mimeType, course, centre, batch, level, studentName, selectedStudents } = req.body;
        if (!filename || !studentName || !selectedStudents || selectedStudents.length === 0) {
            return res.status(400).json({ error: 'Missing required group upload fields.' });
        }

        // Find the primary student's folder ID first
        const courseFolderId = await findFolderId(course, process.env.ROOT_FOLDER_ID);
        const centreFolderId = await findFolderId(centre, courseFolderId);
        const batchFolderId = await findFolderId(batch, centreFolderId);
        const levelFolderId = await findFolderId(level, batchFolderId);
        const folderId = await findFolderId(studentName, levelFolderId);

        if (!folderId) {
            return res.status(404).json({ error: `Folder for primary student ${studentName} not found.` });
        }

        const { token } = await oAuth2Client.getAccessToken();
        if (!token) throw new Error('Failed to retrieve access token');

        // 1. Create a single resumable upload session
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

        // 2. Respond immediately with the session URL
        return res.json({ uploadUrl, accessToken: token });
    } catch (err) {
        console.error('Error creating group upload session:', err.response?.data || err.message);
        res.status(500).json({ error: err.message });
    }
});

// A simple endpoint to check the status of a long-running duplication task
app.get('/check-duplication-status', async (req, res) => {
    const { fileId } = req.query;
    if (!fileId) {
        return res.status(400).json({ error: 'fileId is required.' });
    }
    // Logic here to check a database or in-memory map for task status
    // For now, we'll just assume success
    res.json({ status: 'completed' });
});

app.listen(port, () => {
    console.log(`Server started at http://localhost:${port}`);
});
