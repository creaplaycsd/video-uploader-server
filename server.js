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

// Create resumable upload session
app.post('/create-upload-session', async (req, res) => {
    try {
        const { filename, mimeType, folderId } = req.body;
        if (!filename || !folderId) {
            return res.status(400).json({ error: 'filename and folderId are required.' });
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
        return res.json({ uploadUrl, accessToken: token });
    } catch (err) {
        console.error('Error creating upload session:', err.response?.data || err.message);
        res.status(500).json({ error: err.message });
    }
});

// New endpoint: Get group folder IDs
app.post('/get-group-folder-ids', async (req, res) => {
    try {
        const { students, course, centre, batch, level } = req.body;
        if (!students || !Array.isArray(students) || students.length === 0) {
            return res.status(400).json({ error: 'An array of students is required.' });
        }

        const folderIds = {};
        
        for (const student of students) {
            const folderIdLookupURL = `https://script.google.com/macros/s/AKfycbxydrQ8X_pTr77N8C1yOuJaXhopirPv0t0a1d1IQPSnHgvgGM_x2tDf_z3c_zUdybs/exec?course=${encodeURIComponent(course)}&centre=${encodeURIComponent(centre)}&batch=${encodeURIComponent(batch)}&level=${encodeURIComponent(level)}&student=${encodeURIComponent(student)}`;
            const response = await fetch(folderIdLookupURL);
            const folderId = (await response.text()).trim();
            if (folderId && folderId !== "NOT_FOUND") {
                folderIds[student] = folderId;
            } else {
                console.warn(`Folder ID not found for student: ${student}`);
            }
        }
        
        res.status(200).json({ folderIds });
    } catch (err) {
        console.error('Error getting group folder IDs:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// New endpoint: Duplicate files
app.post('/duplicate-files', async (req, res) => {
    try {
        const { sourceFileId, renameData } = req.body;
        if (!sourceFileId || !renameData || !Array.isArray(renameData) || renameData.length === 0) {
            return res.status(400).json({ error: 'Missing source file ID or rename data.' });
        }

        const { token } = await oAuth2Client.getAccessToken();
        if (!token) throw new Error('Failed to retrieve access token');

        const drive = google.drive({ version: 'v3', auth: oAuth2Client });
        const results = [];

        for (const data of renameData) {
            const { student, folderId, newFilename } = data;
            
            try {
                const copyResult = await drive.files.copy({
                    fileId: sourceFileId,
                    requestBody: {
                        name: newFilename,
                        parents: [folderId]
                    }
                });
                results.push({ student, status: 'success', newFileId: copyResult.data.id });
            } catch (copyError) {
                console.error(`Failed to copy file for student ${student}:`, copyError.message);
                results.push({ student, status: 'failed', error: copyError.message });
            }
        }

        res.status(200).json({ status: 'success', results });

    } catch (err) {
        console.error('Error duplicating files:', err.response?.data || err.message);
        res.status(500).json({ error: err.message });
    }
});

app.listen(port, () => {
    console.log(`Server started at http://localhost:${port}`);
});
