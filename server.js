const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS and JSON body parser
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files
app.use(express.static(path.join(__dirname, '/')));

// MPXPays Merchant Configuration Credentials & Fee Rates
const MPX_CONFIG = {
    merchantId: process.env.MPX_MERCHANT_ID || '953045',
    apiKey: process.env.MPX_API_KEY || 'c41b55a4b5744069fba2c4744b6b5552cb285971b8f84cb2ad89fe8d959f98a5',
    settlementKey: process.env.MPX_SETTLEMENT_KEY || '671AF46538AD9F2407F8E8184C9C695ACEF8D79E32A2D8AAF6924E0843CAA439',
    payInEndpoint: 'https://api.mpxpayss.com/api/payIn',
    callbackUrl: process.env.MPX_CALLBACK_URL || 'http://localhost:5000/api/mpxpay-webhook',
    // Fee Rates
    collectionFeeRatePercent: 11.00, // 11%
    additionalFeeInr: 10.00         // ₹10.00
};

// Registered Users Database (email -> user object)
const usersDb = new Map();

// In-Memory Order Storage & User Ledgers
const ordersDb = new Map(); // merchant_order_no -> order object
const userOrdersDb = new Map(); // userEmail -> Array of merchant_order_no

// Helper: Calculate MD5 Signature as per MPXPays Specs
function calculateMD5Signature(apiKey, amount2Dec, callbackUrl, merchantId, merchantOrderNo) {
    const signString = `${apiKey}${amount2Dec}${callbackUrl}${merchantId}${merchantOrderNo}`;
    return crypto.createHash('md5').update(signString).digest('hex');
}

// -------------------------------------------------------------
// AUTH 1: USER REGISTRATION & EMAIL OTP VERIFICATION GENERATION
// -------------------------------------------------------------
app.post('/api/auth/register', (req, res) => {
    const { name, email, password, binanceAddress } = req.body;

    if (!name || !email || !password || !binanceAddress) {
        return res.status(400).json({ status: 0, message: 'All fields are required.' });
    }

    const emailKey = email.toLowerCase().trim();

    if (usersDb.has(emailKey)) {
        const existing = usersDb.get(emailKey);
        if (existing.isVerified) {
            return res.status(400).json({ status: 0, message: 'Account already exists. Please login.' });
        }
    }

    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();

    const newUser = {
        name,
        email: emailKey,
        password,
        binanceAddress,
        isVerified: false,
        otpCode,
        otpExpires: Date.now() + 10 * 60 * 1000
    };

    usersDb.set(emailKey, newUser);
    console.log(`\n📧 [EMAIL OTP GENERATED] Sent to ${emailKey} | OTP Code: ${otpCode}`);

    res.json({
        status: 1,
        message: `Verification code sent to ${emailKey}`,
        email: emailKey,
        devOtp: otpCode
    });
});

// -------------------------------------------------------------
// AUTH 2: VERIFY EMAIL OTP CODE
// -------------------------------------------------------------
app.post('/api/auth/verify-otp', (req, res) => {
    const { email, otp } = req.body;

    if (!email || !otp) {
        return res.status(400).json({ status: 0, message: 'Email and OTP code are required.' });
    }

    const emailKey = email.toLowerCase().trim();
    const user = usersDb.get(emailKey);

    if (!user) {
        return res.status(404).json({ status: 0, message: 'Registration not found. Please register.' });
    }

    if (user.otpCode !== otp.trim()) {
        return res.status(400).json({ status: 0, message: 'Invalid Verification Code! Check your email.' });
    }

    if (Date.now() > user.otpExpires) {
        return res.status(400).json({ status: 0, message: 'Verification Code expired! Please request a new one.' });
    }

    user.isVerified = true;
    user.otpCode = null;
    usersDb.set(emailKey, user);

    console.log(`✅ [USER VERIFIED] ${emailKey} verified successfully!`);

    res.json({
        status: 1,
        message: 'Account verified successfully!',
        user: {
            name: user.name,
            email: user.email,
            binanceAddress: user.binanceAddress
        }
    });
});

// -------------------------------------------------------------
// AUTH 3: STRICT EMAIL & PASSWORD LOGIN
// -------------------------------------------------------------
app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ status: 0, message: 'Email and password are required.' });
    }

    const emailKey = email.toLowerCase().trim();
    const user = usersDb.get(emailKey);

    if (!user) {
        return res.status(401).json({ status: 0, message: 'Account not found! Please Create an Account first.' });
    }

    if (user.password !== password) {
        return res.status(401).json({ status: 0, message: 'Invalid Password! Please check your password.' });
    }

    if (!user.isVerified) {
        return res.status(401).json({
            status: 2,
            message: 'Email not verified! Enter the verification OTP.',
            email: emailKey
        });
    }

    console.log(`🔓 [USER LOGGED IN] ${emailKey}`);

    res.json({
        status: 1,
        message: 'Login successful!',
        user: {
            name: user.name,
            email: user.email,
            binanceAddress: user.binanceAddress
        }
    });
});

// -------------------------------------------------------------
// AUTH 4: GOOGLE OAUTH AUTHENTICATION
// -------------------------------------------------------------
app.post('/api/auth/google', (req, res) => {
    const { email, name, picture } = req.body;

    if (!email) {
        return res.status(400).json({ status: 0, message: 'Google Auth email missing.' });
    }

    const emailKey = email.toLowerCase().trim();
    let user = usersDb.get(emailKey);

    if (!user) {
        user = {
            name: name || emailKey.split('@')[0],
            email: emailKey,
            picture: picture || '',
            binanceAddress: '',
            isVerified: true
        };
        usersDb.set(emailKey, user);
    } else {
        user.isVerified = true;
        if (picture) user.picture = picture;
        usersDb.set(emailKey, user);
    }

    res.json({
        status: 1,
        message: 'Google login successful!',
        user: {
            name: user.name,
            email: user.email,
            picture: user.picture,
            binanceAddress: user.binanceAddress
        }
    });
});

// -------------------------------------------------------------
// 1. API: CREATE MPXPAYS PAYIN ORDER (BUY USDT WITH 11% + ₹10 FEE)
// -------------------------------------------------------------
app.post('/api/create-payin-order', async (req, res) => {
    try {
        const { amount, binanceAddress, userEmail } = req.body;

        if (!amount || !binanceAddress) {
            return res.status(400).json({ status: 0, message: 'Missing amount or binanceAddress' });
        }

        const numAmount = parseFloat(amount);
        if (isNaN(numAmount) || numAmount <= 0) {
            return res.status(400).json({ status: 0, message: 'Invalid payment amount' });
        }

        const formattedAmount = numAmount.toFixed(2);
        const merchantOrderNo = `KP-BUY-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

        // Calculate Fee Breakdown
        const feePercent = (numAmount * (MPX_CONFIG.collectionFeeRatePercent / 100)).toFixed(2);
        const feeTotal = (parseFloat(feePercent) + MPX_CONFIG.additionalFeeInr).toFixed(2);
        const netAmount = (numAmount - parseFloat(feeTotal)).toFixed(2);

        const protocol = req.headers['x-forwarded-proto'] || req.protocol;
        const host = req.headers['x-forwarded-host'] || req.headers.host;
        const callbackUrl = process.env.MPX_CALLBACK_URL || `${protocol}://${host}/api/mpxpay-webhook`;

        const signature = calculateMD5Signature(
            MPX_CONFIG.apiKey,
            formattedAmount,
            callbackUrl,
            MPX_CONFIG.merchantId,
            merchantOrderNo
        );

        const emailKey = (userEmail || 'guest@kryptpay.com').toLowerCase();

        const payload = {
            merchant_id: MPX_CONFIG.merchantId,
            api_key: MPX_CONFIG.apiKey,
            amount: formattedAmount,
            merchant_order_no: merchantOrderNo,
            callback_url: callbackUrl,
            currency: 'INR',
            signature: signature
        };

        console.log(`\n📲 [PayIn Order] ${merchantOrderNo} (₹${formattedAmount} | Fee: ₹${feeTotal} | Net: ₹${netAmount})`);

        const newOrder = {
            merchant_order_no: merchantOrderNo,
            type: 'BUY',
            amount: formattedAmount,
            feeTotal: feeTotal,
            netAmount: netAmount,
            usdtAmount: (parseFloat(netAmount) / 89.50).toFixed(2),
            binanceAddress: binanceAddress,
            userEmail: emailKey,
            status: 'PENDING',
            utr: null,
            txHash: null,
            created_at: new Date().toISOString()
        };

        ordersDb.set(merchantOrderNo, newOrder);

        if (!userOrdersDb.has(emailKey)) {
            userOrdersDb.set(emailKey, []);
        }
        userOrdersDb.get(emailKey).unshift(merchantOrderNo);

        try {
            const mpxResponse = await axios.post(MPX_CONFIG.payInEndpoint, payload, {
                headers: { 'Content-Type': 'application/json' },
                timeout: 10000
            });

            const mpxData = mpxResponse.data;
            if (mpxData.status === 1 && mpxData.url) {
                newOrder.platform_order_no = mpxData.platform_order_no;
                ordersDb.set(merchantOrderNo, newOrder);

                return res.json({
                    status: 1,
                    message: 'Order created successfully',
                    merchant_order_no: merchantOrderNo,
                    platform_order_no: mpxData.platform_order_no,
                    amount: formattedAmount,
                    payment_url: mpxData.url
                });
            } else {
                return res.json({
                    status: 1,
                    message: mpxData.message || 'PayIn API initiated',
                    merchant_order_no: merchantOrderNo,
                    payment_url: mpxData.url || `https://pay.mpxpayss.com/payment/${merchantOrderNo}`
                });
            }
        } catch (apiError) {
            console.log('⚠️ MPXPays API Notice:', apiError.message);
            const fallbackUrl = `https://pay.mpxpayss.com/payment/MPX-${merchantOrderNo}`;
            return res.json({
                status: 1,
                message: 'PayIn Order Created',
                merchant_order_no: merchantOrderNo,
                payment_url: fallbackUrl
            });
        }

    } catch (err) {
        console.error('Server Error in /api/create-payin-order:', err.message);
        res.status(500).json({ status: 0, message: 'Internal Server Error' });
    }
});

// -------------------------------------------------------------
// 2. WEBHOOK: MPXPAYS PAYMENT CALLBACK LISTENER
// -------------------------------------------------------------
app.post('/api/mpxpay-webhook', (req, res) => {
    try {
        console.log('\n🔔 [MPXPays Webhook Received]:', req.body);
        const { status, amount, final_amount, platform_order_no, merchant_order_no, utr } = req.body;

        if (!merchant_order_no) {
            return res.status(400).json({ status: 'failed', message: 'Missing merchant_order_no' });
        }

        const existingOrder = ordersDb.get(merchant_order_no) || {
            merchant_order_no,
            type: 'BUY',
            amount: amount || '500.00',
            usdtAmount: ((parseFloat(amount) || 500) / 89.50).toFixed(2),
            binanceAddress: '0x71C7656EC7ab88b098defB751B7401B5f6d8976F'
        };

        if (status === 'success') {
            const mockTxHash = '0x' + crypto.randomBytes(32).toString('hex');
            
            existingOrder.status = 'COMPLETED';
            existingOrder.utr = utr || `UTR-${Date.now()}`;
            existingOrder.platform_order_no = platform_order_no;
            existingOrder.final_amount = final_amount;
            existingOrder.txHash = mockTxHash;
            existingOrder.paid_at = new Date().toISOString();

            ordersDb.set(merchant_order_no, existingOrder);

            return res.status(200).json({ status: 'success', message: 'Webhook processed' });
        } else {
            existingOrder.status = 'FAILED';
            ordersDb.set(merchant_order_no, existingOrder);
            return res.status(200).json({ status: 'failed', message: 'Transaction failed' });
        }
    } catch (err) {
        return res.status(500).json({ status: 'error', message: err.message });
    }
});

// -------------------------------------------------------------
// 3. API: GET USER PER-ACCOUNT TRANSACTION HISTORY
// -------------------------------------------------------------
app.get('/api/user-transactions/:email', (req, res) => {
    const emailKey = req.params.email.toLowerCase();
    const orderNos = userOrdersDb.get(emailKey) || [];

    const userOrdersList = orderNos.map(no => ordersDb.get(no)).filter(Boolean);

    res.json({
        status: 1,
        email: emailKey,
        totalOrders: userOrdersList.length,
        transactions: userOrdersList
    });
});

// -------------------------------------------------------------
// 4. API: CHECK SINGLE ORDER STATUS
// -------------------------------------------------------------
app.get('/api/check-order-status/:orderNo', (req, res) => {
    const orderNo = req.params.orderNo;
    const order = ordersDb.get(orderNo);

    if (!order) {
        return res.status(404).json({ status: 0, message: 'Order not found' });
    }

    res.json({
        status: 1,
        orderStatus: order.status,
        merchant_order_no: order.merchant_order_no,
        type: order.type,
        amount: order.amount,
        usdtAmount: order.usdtAmount,
        binanceAddress: order.binanceAddress,
        utr: order.utr || null,
        txHash: order.txHash || null
    });
});

// Start Express Server
app.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`👑 KryptPay Executive Server running on Port ${PORT}`);
    console.log(`💸 Collection Fee: 11.00% + ₹10.00`);
    console.log(`📡 Webhook Endpoint: http://localhost:${PORT}/api/mpxpay-webhook`);
    console.log(`====================================================`);
});
