# How to Deploy to Vercel (Free)

This takes about 10 minutes total, no credit card required.

---

## Step 1 — Create a GitHub account (if you don't have one)
Go to https://github.com and sign up. GitHub is where your code lives online.

## Step 2 — Create a new GitHub repository
1. Click the **+** icon in the top right → **New repository**
2. Name it: `prospect-research-tool`
3. Set it to **Public** (Vercel needs to read it)
4. Click **Create repository**

## Step 3 — Upload your code to GitHub
The easiest way (no command line needed):
1. On your new repo page, click **uploading an existing file**
2. Drag and drop the entire `prospect-research-tool` folder — but upload the FILES INSIDE it, not the folder itself
3. You need to upload: `package.json`, `vite.config.js`, `tailwind.config.js`, `postcss.config.js`, `index.html`
4. Then create a `src/` folder — GitHub allows this during upload
5. Upload inside `src/`: `main.jsx`, `App.jsx`, `index.css`
6. Scroll down, click **Commit changes**

> **Note:** Do NOT upload the `node_modules/` or `dist/` folders — these are generated automatically by Vercel.

## Step 4 — Connect to Vercel
1. Go to https://vercel.com → **Sign up with GitHub**
2. Click **Add New Project**
3. Find and select your `prospect-research-tool` repo
4. Vercel will auto-detect it as a Vite project
5. Leave all settings as default
6. Click **Deploy**

Vercel builds and deploys in ~30 seconds. You'll get a live URL like:
`https://prospect-research-tool-marek.vercel.app`

## Step 5 — Test it
Open the URL, paste your Anthropic API key, fill in the form, hit Run.

---

## Your Live URL
Once deployed, add it here: ___________________________

## Interview talking points
- "It's a client-side React app built with Vite, deployed on Vercel's edge network"
- "The AI layer uses claude-sonnet-4 with Anthropic's built-in web_search tool — so it finds real businesses, not invented ones"
- "The tool-use loop handles multi-turn agent behaviour — Claude searches, I acknowledge, it continues"
- "The API key never touches a server I control — it goes from the browser directly to Anthropic over HTTPS"
- "CSV export, priority filtering, and copy-to-clipboard are all in the design because they fit the actual workflow: research → review → send"
