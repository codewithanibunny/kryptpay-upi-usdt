# 💻 NexaPay 24/7 Windows Laptop Hosting & Custom Domain Guide

This guide details how to host **NexaPay** 24/7 directly from your Windows laptop/PC using **Cloudflare Tunnel** for **100% FREE Lifetime Custom Domain + Automatic HTTPS SSL**.

---

## ⚡ Why Laptop Hosting with Cloudflare Tunnel?
- **₹0 VPS Cost**: Lifetime 100% Free.
- **Auto HTTPS/SSL**: Free SSL Certificate (`https://yourdomain.com`).
- **No Port Forwarding Needed**: Works on any Home WiFi / Jio / Airtel / Broadband.
- **Auto-Reconnect**: If WiFi disconnects & reconnects, tunnel reconnects in <1 sec.

---

## 🌐 STEP 1: Setup Custom Domain on Cloudflare Tunnel (1-Time Setup)

1. Go to **[Cloudflare Zero Trust Console](https://one.dash.cloudflare.com/)** (Free account).
2. Go to **Networks** ➡️ **Tunnels** ➡️ Click **Create a Tunnel**.
3. Tunnel Name: `nexapay-laptop` ➡️ Click **Save**.
4. Choose **Windows** ➡️ Copy the **Connector Command** (it looks like this):
   ```cmd
   cloudflared.exe service install <YOUR_SECRET_TOKEN>
   ```
5. Open Windows Terminal (PowerShell / CMD as Admin) and paste that command.
6. In Cloudflare Console under **Public Hostname**:
   - **Subdomain/Domain**: `yourdomain.com` (or `pay.yourdomain.com`)
   - **Type**: `HTTP`
   - **URL**: `localhost:5000`
7. Click **Save Hostname**! 

🎉 **Your custom domain (`https://yourdomain.com`) is now LIVE 24/7 connected to your laptop!**

---

## 🛠️ STEP 2: Configure `.env` on your Laptop

Open `.env` in your `upi-usdt-onramp` folder:

```env
PORT=5000
MPX_CALLBACK_URL=https://yourdomain.com/api/mpxpay-webhook
GOOGLE_CLIENT_ID=459964446959-9se2u9p8mahbili06u56otgvqafcieem.apps.googleusercontent.com
FIREBASE_WEB_API_KEY=AIzaSyDFUchfILqyc8ck7hAlA6V3-p-YGQ_FXv0
FIREBASE_SERVICE_ACCOUNT_PATH=./serviceAccountKey.json
MPX_MERCHANT_ID=953045
MPX_API_KEY=c41b55a4b5744069fba2c4744b6b5552cb285971b8f84cb2ad89fe8d959f98a5
MPX_SETTLEMENT_KEY=671AF46538AD9F2407F8E8184C9C695ACEF8D79E32A2D8AAF6924E0843CAA439
```

---

## 🔄 STEP 3: Auto-Start Server on Laptop Reboot

To ensure `node server.js` starts automatically whenever your laptop boots up:

### Method A: Using PM2 Windows Service (Recommended)
Open PowerShell / CMD as Administrator:
```cmd
npm install -g pm2 pm2-windows-service
pm2 start server.js --name "nexapay"
pm2 save
```

### Method B: Double Click `start-server.bat`
You can double-click `start-server.bat` anytime to run the server in the background.

---

## 🚀 Instant Test Tunnel (No Domain Setup Required)

If you want an instant public HTTPS link right now without connecting a custom domain yet, run:

```cmd
"C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel --url http://localhost:5000
```
It will output a free `https://xxxx.trycloudflare.com` URL instantly!
