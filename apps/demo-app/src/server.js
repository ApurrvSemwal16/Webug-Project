const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// Products API
app.get('/api/products', (req, res) => {
  res.json([
    { id: 1, name: 'Wireless Headphones', price: 99.99, description: 'Premium noise-canceling headphones' },
    { id: 2, name: 'Smart Watch', price: 249.99, description: 'Latest generation smartwatch with health tracking' },
    { id: 3, name: 'Laptop Stand', price: 49.99, description: 'Ergonomic aluminum laptop stand' },
    { id: 4, name: 'Mechanical Keyboard', price: 129.99, description: 'RGB mechanical keyboard with Cherry MX switches' },
  ]);
});

// Cart API (in-memory for demo)
let cart = [];

app.get('/api/cart', (req, res) => {
  res.json(cart);
});

app.post('/api/cart', (req, res) => {
  const { productId, quantity = 1 } = req.body;
  const products = [
    { id: 1, name: 'Wireless Headphones', price: 99.99 },
    { id: 2, name: 'Smart Watch', price: 249.99 },
    { id: 3, name: 'Laptop Stand', price: 49.99 },
    { id: 4, name: 'Mechanical Keyboard', price: 129.99 },
  ];
  const product = products.find(p => p.id === productId);
  if (!product) {
    return res.status(404).json({ error: 'Product not found' });
  }
  const existingItem = cart.find(item => item.productId === productId);
  if (existingItem) {
    existingItem.quantity += quantity;
  } else {
    cart.push({ productId, name: product.name, price: product.price, quantity });
  }
  res.json(cart);
});

app.delete('/api/cart/:productId', (req, res) => {
  const { productId } = req.params;
  cart = cart.filter(item => item.productId !== parseInt(productId));
  res.json(cart);
});

// Checkout API
app.post('/api/checkout', (req, res) => {
  const { email, shippingAddress } = req.body;
  if (!email || !shippingAddress) {
    return res.status(400).json({ error: 'Email and shipping address required' });
  }
  const orderId = 'ORD-' + Date.now();
  const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  res.json({
    orderId,
    email,
    shippingAddress,
    items: cart,
    total,
    status: 'confirmed',
    timestamp: Date.now(),
  });
});

// COUPON API - INTENTIONAL BUG: Returns 500 for specific coupons
app.post('/api/coupon', (req, res) => {
  const { code } = req.body;

  // Simulate a bug: certain coupon codes cause server error
  const buggyCodes = ['SAVE10', 'DISCOUNT20', 'BUGGY50'];

  if (buggyCodes.includes(code?.toUpperCase())) {
    // This is the intentional bug - returns 500 instead of proper error handling
    console.error(`[BUG] Coupon validation failed for code: ${code}`);
    throw new Error('Coupon validation service unavailable');
  }

  // Valid coupons
  const validCoupons = {
    'WELCOME10': { discount: 10, type: 'percent' },
    'SAVE20': { discount: 20, type: 'percent' },
    'FREESHIP': { discount: 9.99, type: 'fixed' },
  };

  const coupon = validCoupons[code?.toUpperCase()];
  if (!coupon) {
    return res.status(400).json({ valid: false, message: 'Invalid coupon code' });
  }

  res.json({ valid: true, code, ...coupon });
});

// Order confirmation page data
app.get('/api/order/:orderId', (req, res) => {
  const { orderId } = req.params;
  // In a real app, this would fetch from database
  res.json({
    orderId,
    status: 'confirmed',
    items: cart,
    total: cart.reduce((sum, item) => sum + item.price * item.quantity, 0),
  });
});

// Serve the SPA for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Error handler (catches the thrown error from coupon API)
app.use((err, req, res, next) => {
  console.error('Server error:', err.message);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Demo app running on http://0.0.0.0:${PORT}`);
});