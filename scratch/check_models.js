const fs = require('fs');

const envContent = fs.readFileSync('./.env', 'utf-8');
const apiKeyMatch = envContent.match(/GEMINI_API_KEY=(.*)/);
const apiKey = apiKeyMatch ? apiKeyMatch[1].trim() : '';

async function listModels(apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
  try {
    const response = await fetch(url);
    const data = await response.json();
    data.models.forEach(m => console.log(m.name, '-', m.displayName));
  } catch(e) {
    console.error(e);
  }
}

listModels(apiKey);
