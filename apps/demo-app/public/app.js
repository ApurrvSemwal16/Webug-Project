// AgentQA Demo Store - SPA Application
class DemoStore {
  constructor() {
    this.cart = [];
    this.currentPage = 'home';
    this.coupon = null;
    this.init();
  }

  async init() {
    await this.loadProducts();
    this.bindEvents();
    this.updateCartCount();
    this.showPage('home');
  }

  async loadProducts() {
    try {
      const response = await fetch('/api/products');
      const products = await response.json();
      this.renderProducts(products);
    } catch (error) {
      console.error('Failed to load products:', error);
    }
  }

  renderProducts(products) {
    const container = document.getElementById('products');
    container.innerHTML = products.map(product => `
      <div class="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
        <div class="bg-gray-100 h-48 flex items-center justify-center">
          <svg class="w-16 h-16 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/>
          </svg>
        </div>
        <div class="p-4">
          <h3 class="font-semibold text-gray-900 mb-1">${product.name}</h3>
          <p class="text-sm text-gray-500 mb-2">${product.description}</p>
          <div class="flex justify-between items-center">
            <span class="text-lg font-bold text-gray-900">$${product.price.toFixed(2)}</span>
            <button
              class="add-to-cart bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
              data-product-id="${product.id}"
              data-product-name="${product.name}"
              data-product-price="${product.price}"
            >
              Add to Cart
            </button>
          </div>
        </div>
      </div>
    `).join('');

    // Bind add to cart buttons
    document.querySelectorAll('.add-to-cart').forEach(btn => {
      btn.addEventListener('click', (e) => this.addToCart(e.target.dataset));
    });
  }

  async addToCart(data) {
    try {
      const response = await fetch('/api/cart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: parseInt(data.productId), quantity: 1 })
      });
      this.cart = await response.json();
      this.updateCartCount();
      this.renderCart();
      this.showNotification(`${data.productName} added to cart!`);
    } catch (error) {
      console.error('Failed to add to cart:', error);
    }
  }

  async removeFromCart(productId) {
    try {
      const response = await fetch(`/api/cart/${productId}`, { method: 'DELETE' });
      this.cart = await response.json();
      this.updateCartCount();
      this.renderCart();
      this.renderCheckoutItems();
    } catch (error) {
      console.error('Failed to remove from cart:', error);
    }
  }

  updateCartCount() {
    const count = this.cart.reduce((sum, item) => sum + item.quantity, 0);
    const countEl = document.getElementById('cart-count');
    countEl.textContent = count;
    countEl.style.display = count > 0 ? 'flex' : 'none';
  }

  renderCart() {
    const container = document.getElementById('cart-items');
    const emptyEl = document.getElementById('cart-empty');
    const summaryEl = document.getElementById('cart-summary');

    if (this.cart.length === 0) {
      container.innerHTML = '';
      emptyEl.classList.remove('hidden');
      summaryEl.classList.add('hidden');
      return;
    }

    emptyEl.classList.add('hidden');
    summaryEl.classList.remove('hidden');

    container.innerHTML = this.cart.map(item => `
      <div class="flex items-center p-4 border-b border-gray-200 last:border-0" data-product-id="${item.productId}">
        <div class="bg-gray-100 w-16 h-16 rounded-lg flex items-center justify-center flex-shrink-0">
          <svg class="w-8 h-8 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4m0-10L4 7m8 4v10M4 7v10l8 4"/>
          </svg>
        </div>
        <div class="ml-4 flex-1">
          <h4 class="font-medium text-gray-900">${item.name}</h4>
          <p class="text-sm text-gray-500">$${item.price.toFixed(2)} each</p>
        </div>
        <div class="flex items-center space-x-2">
          <button class="qty-btn decrement w-8 h-8 rounded border border-gray-300 flex items-center justify-center hover:bg-gray-100" data-id="${item.productId}">-</button>
          <span class="w-10 text-center font-medium">${item.quantity}</span>
          <button class="qty-btn increment w-8 h-8 rounded border border-gray-300 flex items-center justify-center hover:bg-gray-100" data-id="${item.productId}">+</button>
        </div>
        <span class="ml-4 font-semibold text-gray-900">$${(item.price * item.quantity).toFixed(2)}</span>
        <button class="remove-btn ml-4 text-red-500 hover:text-red-700 text-sm font-medium" data-id="${item.productId}">Remove</button>
      </div>
    `).join('');

    // Bind quantity buttons
    document.querySelectorAll('.qty-btn.increment').forEach(btn => {
      btn.addEventListener('click', () => this.updateQuantity(parseInt(btn.dataset.id), 1));
    });
    document.querySelectorAll('.qty-btn.decrement').forEach(btn => {
      btn.addEventListener('click', () => this.updateQuantity(parseInt(btn.dataset.id), -1));
    });
    document.querySelectorAll('.remove-btn').forEach(btn => {
      btn.addEventListener('click', () => this.removeFromCart(parseInt(btn.dataset.id)));
    });

    this.updateCartSummary();
  }

  async updateQuantity(productId, delta) {
    const item = this.cart.find(i => i.productId === productId);
    if (!item) return;

    const newQty = item.quantity + delta;
    if (newQty < 1) {
      await this.removeFromCart(productId);
      return;
    }

    try {
      const response = await fetch('/api/cart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId, quantity: newQty - item.quantity })
      });
      this.cart = await response.json();
      this.updateCartCount();
      this.renderCart();
      this.renderCheckoutItems();
    } catch (error) {
      console.error('Failed to update quantity:', error);
    }
  }

  updateCartSummary() {
    const subtotal = this.cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const shipping = this.cart.length > 0 ? 9.99 : 0;
    let discount = 0;

    if (this.coupon) {
      if (this.coupon.type === 'percent') {
        discount = subtotal * (this.coupon.discount / 100);
      } else {
        discount = this.coupon.discount;
      }
    }

    const total = subtotal + shipping - discount;

    document.getElementById('subtotal').textContent = `$${subtotal.toFixed(2)}`;
    document.getElementById('shipping').textContent = `$${shipping.toFixed(2)}`;
    document.getElementById('total').textContent = `$${total.toFixed(2)}`;

    const checkoutBtn = document.getElementById('checkout-btn');
    checkoutBtn.disabled = this.cart.length === 0;
  }

  async applyCoupon() {
    const input = document.getElementById('coupon-input');
    const code = input.value.trim().toUpperCase();
    const messageEl = document.getElementById('coupon-message');

    if (!code) return;

    try {
      const response = await fetch('/api/coupon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code })
      });

      const data = await response.json();

      if (response.ok && data.valid) {
        this.coupon = { code: data.code, discount: data.discount, type: data.type };
        messageEl.textContent = `Coupon applied: ${data.discount}${data.type === 'percent' ? '%' : '$'} off!`;
        messageEl.className = 'text-sm mt-2 text-green-600';
        input.value = '';
      } else {
        messageEl.textContent = data.message || 'Invalid coupon code';
        messageEl.className = 'text-sm mt-2 text-red-600';
      }
      messageEl.classList.remove('hidden');
      this.updateCartSummary();
      this.renderCheckoutItems();
    } catch (error) {
      messageEl.textContent = 'Error applying coupon. Please try again.';
      messageEl.className = 'text-sm mt-2 text-red-600';
      messageEl.classList.remove('hidden');
      console.error('Coupon error:', error);
    }
  }

  showPage(page) {
    document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
    const pageEl = document.getElementById(`${page}-page`);
    if (pageEl) pageEl.classList.remove('hidden');
    this.currentPage = page;

    const targetPath = page === 'home' ? '/' : `/${page}`;
    if (window.location.pathname !== targetPath) {
      window.history.pushState({}, '', targetPath);
    }

    if (page === 'cart') this.renderCart();
    if (page === 'checkout') this.renderCheckoutItems();
  }

  bindEvents() {
    // Navigation
    document.querySelectorAll('a[href^="/"]').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const page = link.getAttribute('href').slice(1) || 'home';
        this.showPage(page);
        window.history.pushState({}, '', link.getAttribute('href'));
      });
    });

    // Cart link in nav
    document.querySelector('a[href="/cart"]').addEventListener('click', (e) => {
      e.preventDefault();
      this.showPage('cart');
    });

    // Home link
    document.querySelector('a[href="/"]').addEventListener('click', (e) => {
      e.preventDefault();
      this.showPage('home');
    });

    // Checkout button
    document.getElementById('checkout-btn').addEventListener('click', () => this.showPage('checkout'));

    // Apply coupon
    document.getElementById('apply-coupon').addEventListener('click', () => this.applyCoupon());
    document.getElementById('coupon-input').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.applyCoupon();
    });

    // Place order
    document.getElementById('place-order').addEventListener('click', () => this.placeOrder());

    // Handle browser back/forward
    window.addEventListener('popstate', () => {
      const path = window.location.pathname;
      const page = path === '/' ? 'home' : path.slice(1);
      this.showPage(page);
    });
  }

  renderCheckoutItems() {
    const container = document.getElementById('checkout-items');
    const subtotal = this.cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const shipping = 9.99;
    let discount = 0;

    if (this.coupon) {
      if (this.coupon.type === 'percent') {
        discount = subtotal * (this.coupon.discount / 100);
      } else {
        discount = this.coupon.discount;
      }
    }

    container.innerHTML = this.cart.map(item => `
      <div class="flex items-center justify-between py-2 border-b border-gray-100">
        <div class="flex items-center">
          <div class="bg-gray-100 w-10 h-10 rounded flex items-center justify-center">
            <svg class="w-5 h-5 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4m0-10L4 7m8 4v10M4 7v10l8 4"/>
            </svg>
          </div>
          <div class="ml-3">
            <p class="text-sm font-medium text-gray-900">${item.name}</p>
            <p class="text-xs text-gray-500">Qty: ${item.quantity}</p>
          </div>
        </div>
        <span class="font-medium text-gray-900">$${(item.price * item.quantity).toFixed(2)}</span>
      </div>
    `).join('');

    document.getElementById('checkout-subtotal').textContent = `$${subtotal.toFixed(2)}`;
    document.getElementById('checkout-shipping').textContent = `$${shipping.toFixed(2)}`;

    const discountRow = document.getElementById('checkout-discount-row');
    const discountEl = document.getElementById('checkout-discount');
    if (discount > 0) {
      discountRow.style.display = 'flex';
      discountEl.textContent = `-$${discount.toFixed(2)}`;
    } else {
      discountRow.style.display = 'none';
    }

    document.getElementById('checkout-total').textContent = `$${(subtotal + shipping - discount).toFixed(2)}`;
  }

  async placeOrder() {
    const email = document.getElementById('checkout-email').value;
    const name = document.getElementById('checkout-name').value;
    const address = document.getElementById('checkout-address').value;
    const city = document.getElementById('checkout-city').value;
    const zip = document.getElementById('checkout-zip').value;

    if (!email || !name || !address || !city || !zip) {
      this.showNotification('Please fill in all required fields', 'error');
      return;
    }

    const shippingAddress = `${name}, ${address}, ${city} ${zip}`;

    try {
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, shippingAddress })
      });

      const order = await response.json();

      // Clear cart and coupon
      this.cart = [];
      this.coupon = null;
      this.updateCartCount();

      // Show confirmation
      this.showConfirmation(order);
    } catch (error) {
      console.error('Failed to place order:', error);
      this.showNotification('Failed to place order. Please try again.', 'error');
    }
  }

  showConfirmation(order) {
    const details = document.getElementById('order-details');
    details.innerHTML = `
      <div class="space-y-2">
        <div class="flex justify-between"><span class="text-gray-600">Order ID</span><span class="font-mono font-medium">${order.orderId}</span></div>
        <div class="flex justify-between"><span class="text-gray-600">Email</span><span>${order.email}</span></div>
        <div class="flex justify-between"><span class="text-gray-600">Items</span><span>${order.items.length}</span></div>
        <div class="flex justify-between"><span class="text-gray-600">Total</span><span class="font-semibold">$${order.total.toFixed(2)}</span></div>
      </div>
    `;
    this.showPage('confirmation');
  }

  showNotification(message, type = 'success') {
    // Create toast notification
    const toast = document.createElement('div');
    toast.className = `fixed bottom-4 right-4 px-6 py-3 rounded-lg shadow-lg text-white z-50 animate-slide-up ${
      type === 'success' ? 'bg-green-600' : 'bg-red-600'
    }`;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('animate-fade-out');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }
}

// Add animation styles
const style = document.createElement('style');
style.textContent = `
  @keyframes slide-up {
    from { opacity: 0; transform: translateY(20px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes fade-out {
    from { opacity: 1; }
    to { opacity: 0; }
  }
  .animate-slide-up { animation: slide-up 0.3s ease-out; }
  .animate-fade-out { animation: fade-out 0.3s ease-in forwards; }
`;
document.head.appendChild(style);

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
  window.demoStore = new DemoStore();
});