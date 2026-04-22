const fs = require('fs');
const https = require('https');

const baseUrl = process.env.GOOGLE_GEMINI_BASE_URL;
const apiKey = process.env.GEMINI_API_KEY;
const model = "gemini-3.1-flash-image-preview";

const prompt = "A cute flat design iOS app icon of a Q-version red lobster with large claws, inside a white chat bubble, on a solid bright blue background. Minimalist, kawaii style, high resolution PNG output.";

const postData = JSON.stringify({
  contents: [{
    parts: [{ text: prompt }]
  }]
});

const url = new URL(`${baseUrl}/v1beta/models/${model}:generateContent`);
const options = {
  hostname: url.hostname,
  port: url.port || 443,
  path: url.pathname,
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
    'Content-Length': Buffer.byteLength(postData)
  }
};

const req = https.request(options, (res) => {
  let responseBody = '';
  res.on('data', (chunk) => responseBody += chunk);
  res.on('end', () => {
    try {
      const json = JSON.parse(responseBody);
      if (json.error) {
        console.error("API Error:", JSON.stringify(json.error, null, 2));
        return;
      }

      const parts = json.candidates?.[0]?.content?.parts || [];
      let found = false;

      for (const part of parts) {
        if (part.inlineData) {
          const imageData = Buffer.from(part.inlineData.data, 'base64');
          fs.writeFileSync('lobster_icon.png', imageData);
          console.log(`Success! Image (${part.inlineData.mimeType}) saved as lobster_icon.png`);
          found = true;
        } else if (part.text) {
          console.log("Model response text:", part.text);
        }
      }

      if (!found) {
        console.log("No image data returned in the response.");
      }
    } catch (e) {
      console.error("Failed to parse response:", responseBody);
    }
  });
});

req.on('error', (e) => console.error(`Error: ${e.message}`));
req.write(postData);
req.end();
