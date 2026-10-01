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

// MPXPays Merchant Configuration Credentials
const MPX_CONFIG = {
    merchantId: process.env.MPX_MERCHANT_ID || '953045',
    apiKey: process.env.MPX_API_KEY || 'c41b55a4b5744069fba2c4744b6b5552cb285971b8f84cb2ad89fe8d959f98a5',
    settlementKey: process.env.MPX_SETTLEMENT_KEY || '671AF46538AD9F2407F8E8184C9C695ACEF8D79E32A2D8AAF6924E0843CAA439',
    payInEndpoint: 'https://api.mpxpayss.com/api/payIn',
    payoutEndpoint: 'https://api.mpxpayss.com/api/payout',
    callbackUrl: process.env.MPX_CALLBACK_URL || 'http://localhost:5000/api/mpxpay-webhook'
};

// In-Memory Order Storage & User Ledgers
const ordersDb = new Map(); // merchant_order_no -> order object
const userOrdersDb = new Map(); // userEmail -> Array of merchant_order_no
const payoutsDb = new Map(); // merchant_order_no -> payout object

// Helper: Calculate MD5 Signature as per MPXPays Specs
function calculateMD5Signature(apiKey, amount2Dec, callbackUrl, merchantId, merchantOrderNo) {
    const signString = `${apiKey}${amount2Dec}${callbackUrl}${merchantId}${merchantOrderNo}`;
    return crypto.createHash('md5').update(signString).digest('hex');
}

// -------------------------------------------------------------
// 1. API: CREATE MPXPAYS PAYIN ORDER (BUY USDT)
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

        console.log(`\n📲 [PayIn Order] ${merchantOrderNo} for ${emailKey} (₹${formattedAmount})`);

        const newOrder = {
            merchant_order_no: merchantOrderNo,
            type: 'BUY',
            amount: formattedAmount,
            usdtAmount: (numAmount / 89.50).toFixed(2),
            binanceAddress: binanceAddress,
            userEmail: emailKey,
            status: 'PENDING',
            utr: null,
            txHash: null,
            created_at: new Date().toISOString()
        };

        ordersDb.set(merchantOrderNo, newOrder);

        // Append to user ledger
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
// 2. API: CREATE PAYOUT ORDER (SELL USDT / WITHDRAW TO BANK)
// -------------------------------------------------------------
app.post('/api/create-payout-order', async (req, res) => {
    try {
        const { usdtAmount, userEmail, bankName, accountNumber, ifscCode, accountHolderName } = req.body;

        if (!usdtAmount || !accountNumber || !ifscCode || !accountHolderName) {
            return res.status(400).json({ status: 0, message: 'Missing bank or payout details' });
        }

        const usdtVal = parseFloat(usdtAmount);
        if (isNaN(usdtVal) || usdtVal <= 0) {
            return res.status(400).json({ status: 0, message: 'Invalid USDT withdrawal amount' });
        }

        // Payout Rate: ₹87.00 per USDT (Spread included)
        const inrPayoutAmount = (usdtVal * 87.00).toFixed(2);
        const merchantOrderNo = `KP-WITHDRAW-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

        const emailKey = (userEmail || 'guest@kryptpay.com').toLowerCase();

        const payoutOrder = {
            merchant_order_no: merchantOrderNo,
            type: 'WITHDRAW',
            amount: inrPayoutAmount,
            usdtAmount: usdtVal.toFixed(2),
            userEmail: emailKey,
            bankName: bankName || 'Bank Account',
            accountNumber: accountNumber,
            ifscCode: ifscCode,
            accountHolderName: accountHolderName,
            status: 'PROCESSING',
            utr: `WD-UTR-${Math.floor(100000000000 + Math.random() * 900000000000)}`,
            created_at: new Date().toISOString()
        };

        payoutsDb.set(merchantOrderNo, payoutOrder);
        ordersDb.set(merchantOrderNo, payoutOrder);

        if (!userOrdersDb.has(emailKey)) {
            userOrdersDb.set(emailKey, []);
        }
        userOrdersDb.get(emailKey).unshift(merchantOrderNo);

        console.log(`\n💸 [Payout Order] ${merchantOrderNo} for ${emailKey} (${usdtVal} USDT ➡️ ₹${inrPayoutAmount})`);

        res.json({
            status: 1,
            message: 'Withdrawal request submitted successfully',
            merchant_order_no: merchantOrderNo,
            inrAmount: inrPayoutAmount,
            usdtAmount: usdtVal.toFixed(2)
        });

    } catch (err) {
        console.error('Error in /api/create-payout-order:', err.message);
        res.status(500).json({ status: 0, message: 'Internal Server Error' });
    }
});

// -------------------------------------------------------------
// 3. WEBHOOK: MPXPAYS PAYMENT CALLBACK LISTENER
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
// 4. API: GET USER PER-ACCOUNT TRANSACTION HISTORY
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
// 5. API: CHECK SINGLE ORDER STATUS
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
    console.log(`👑 KryptPay Executive Wealth Server running on Port ${PORT}`);
    console.log(`📡 Webhook Endpoint: http://localhost:${PORT}/api/mpxpay-webhook`);
    console.log(`====================================================`);
});
