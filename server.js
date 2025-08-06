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

// Google OAuth2 Client setup remains the same
const oAuth2Client = new google.auth.OAuth2(
    process.env.CLIENT_ID,
    process.env.CLIENT_SECRET,
    process.env.REDIRECT_URI
);
oAuth2Client.setCredentials({ refresh_token: process.env.REFRESH_TOKEN });

const drive = google.drive({ version: 'v3', auth: oAuth2Client });

// Health check endpoint
app.get('/', (req, res) => {
    res.send('Video Uploader Server is running!');
});


// =================================================================
// API ROUTES
// =================================================================

/**
 * INDIVIDUAL UPLOAD: Simple proxy endpoint.
 * Receives the final folderId directly from the frontend.
 */
app.post('/create-upload-session', async (req, res) => {
    console.log("Handling individual upload session request...");
    try {
        // The frontend now sends the final folderId directly
        const { filename, mimeType, folderId } = req.body;
        
        if (!filename || !folderId) {
            return res.status(400).json({ error: 'filename and folderId are required.' });
        }

        const { token } = await oAuth2Client.getAccessToken();
        if (!token) throw new Error('Failed to retrieve access token');

        // Create the resumable session using the provided folderId
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

        const uploadUrl = sessionResponse.headers.location;
        console.log("Individual session created successfully.");
        return res.json({ uploadUrl, accessToken: token });

    } catch (err) {
        console.error('Error creating individual upload session:', err.response?.data || err.message);
        res.status(500).json({ error: 'Failed to create upload session.' });
    }
});


/**
 * GROUP UPLOAD: This is an advanced feature.
 * The logic for handling duplication after the primary upload is complete
 * would go here. For now, this endpoint acts identically to the individual
 * upload, using the primary student's folderId.
 */
app.post('/create-group-upload-session', async (req, res) => {
    console.log("Handling group upload session request...");
    try {
        // For now, this behaves just like the individual upload.
        // It uses the primary student's folderId for the initial upload.
        const { filename, mimeType, folderId } = req.body;

        if (!filename || !folderId) {
            return res.status(400).json({ error: 'filename and folderId are required for the primary upload.' });
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

        const uploadUrl = sessionResponse.headers.location;
        console.log("Group session created for primary student. Duplication would be handled separately.");
        return res.json({ uploadUrl, accessToken: token });

    } catch (err) {
        console.error('Error creating group upload session:', err.response?.data || err.message);
        res.status(500).json({ error: 'Failed to create group upload session.' });
    }
});


// Start the server
app.listen(port, () => {
    console.log(`Server started on port ${port}`);
});
