#!/bin/bash

# NexaPay 1-Click Azure VPS Automated Deployment Script
set -e

echo "🚀 Starting NexaPay VPS Installation..."

# 1. Update system packages
sudo apt update && sudo apt upgrade -y

# 2. Install Node.js 20 LTS & Essential Tools
echo "📦 Installing Node.js LTS, Nginx, PM2, and Certbot..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git nginx certbot python3-certbot-nginx ufw

# 3. Configure local Linux Firewall (UFW)
echo "🛡️ Opening Ports 22, 80, 443 in internal firewall..."
sudo ufw allow 22/tcp || true
sudo ufw allow 80/tcp || true
sudo ufw allow 443/tcp || true
sudo ufw allow 'Nginx Full' || true
sudo ufw --force enable || true

# 4. Install PM2 globally
sudo npm install -g pm2

# 5. Create App Directory
APP_DIR="/var/www/nexapay"
sudo mkdir -p $APP_DIR
sudo chown -R $USER:$USER $APP_DIR

# 6. Clone repository
echo "📥 Fetching latest production codebase..."
git clone https://github.com/codewithanibunny/kryptpay-upi-usdt.git $APP_DIR || (cd $APP_DIR && git pull)

cd $APP_DIR
npm install --production

# 7. Configure Nginx Reverse Proxy (Port 80 -> Port 5000)
echo "🌐 Configuring Nginx Reverse Proxy on Port 80 & 443..."
sudo bash -c 'cat > /etc/nginx/sites-available/nexapay << "EOF"
server {
    listen 80;
    listen [::]:80;
    server_name nexapay.work.gd www.nexapay.work.gd;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF'

sudo ln -sf /etc/nginx/sites-available/nexapay /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx

# 8. Start App with PM2
echo "⚙️ Starting NexaPay Server with PM2..."
pm2 stop nexapay || true
pm2 start server.js --name nexapay
pm2 save
pm2 startup | tail -n 1 | sudo bash || true

echo ""
echo "======================================================"
echo "✅ NexaPay Server is running 24/7 on your VPS!"
echo "======================================================"
echo "👉 Point domain nexapay.work.gd A Record to this VPS IP."
echo "🔒 To activate free SSL HTTPS, run:"
echo "   sudo certbot --nginx -d nexapay.work.gd -d www.nexapay.work.gd"
echo "======================================================"
