const devices = Array.from(document.querySelectorAll('.device'));
const labelDisplay = document.getElementById('selected-label');
const carouselWrapper = document.querySelector('.carousel-wrapper');
const dragTarget = carouselWrapper || document.body;
const MENU_SELECTED_DEVICE_KEY = 'menu.selectedDeviceLabel';

function getDefaultIndex() {
  const preferred = devices.findIndex((device) => device.dataset.label === 'CPO');
  return preferred >= 0 ? preferred : 0;
}

function getSavedIndex() {
  try {
    const savedLabel = localStorage.getItem(MENU_SELECTED_DEVICE_KEY);
    if (!savedLabel) return -1;
    return devices.findIndex((device) => device.dataset.label === savedLabel);
  } catch {
    return -1;
  }
}

let currentIndex = getSavedIndex();
if (currentIndex < 0) {
  currentIndex = devices.findIndex((d) => d.dataset.label === (labelDisplay?.textContent || ''));
}
if (currentIndex < 0) currentIndex = getDefaultIndex();
let lastIndex = currentIndex;

function getRoute(label) {
  if (label === 'CPO') return '/CPO/1';
  if (label === 'Controleur mobile') return '/ControllerMobile/1';
  if (label === 'C2') return '/C2/1';
  return null;
}

function navigateIfAvailable(label) {
  const route = getRoute(label);
  if (route) window.location.href = route;
}

function updateCarousel() {
  devices.forEach((device, i) => {
    let rel = i - currentIndex;
    if (rel > devices.length / 2) rel -= devices.length;
    if (rel < -devices.length / 2) rel += devices.length;

    device.classList.remove('slot-left', 'slot-center', 'slot-right', 'slot-back', 'back');
    if (rel === 0) device.classList.add('slot-center');
    else if (rel === -1) device.classList.add('slot-left');
    else if (rel === 1) device.classList.add('slot-right');
    else device.classList.add('slot-back');

    const isBack = rel === 2 || rel === -2;
    device.classList.toggle('back', isBack);

    const isActive = rel === 0;
    device.classList.toggle('active', isActive);
    device.classList.toggle('side', !isActive);
    device.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });

  if (labelDisplay) {
    labelDisplay.textContent = devices[currentIndex].dataset.label;
  }

  try {
    const currentLabel = devices[currentIndex]?.dataset?.label;
    if (currentLabel) {
      localStorage.setItem(MENU_SELECTED_DEVICE_KEY, currentLabel);
    }
  } catch {
    // Ignore storage write errors.
  }

  if (lastIndex !== currentIndex) {
    const active = devices[currentIndex];
    if (active) {
      active.classList.remove('pulse');
      void active.offsetWidth;
      active.classList.add('pulse');
    }
    lastIndex = currentIndex;
  }
}

function move(delta) {
  currentIndex = (currentIndex + delta + devices.length) % devices.length;
  updateCarousel();
}

devices.forEach((d, i) => {
  d.addEventListener('click', () => {
    const isActive = i === currentIndex;
    currentIndex = i;
    updateCarousel();
    if (isActive) navigateIfAvailable(d.dataset.label || '');
  });
  d.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const isActive = i === currentIndex;
      currentIndex = i;
      updateCarousel();
      if (isActive) navigateIfAvailable(d.dataset.label || '');
    }
  });
});

let startX = 0;
let isDragging = false;

dragTarget.addEventListener('mousedown', (e) => {
  isDragging = true;
  startX = e.clientX;
});

dragTarget.addEventListener('mouseup', (e) => {
  if (!isDragging) return;
  isDragging = false;
  const diff = e.clientX - startX;
  if (diff > 30) move(-1);
  if (diff < -30) move(1);
});

dragTarget.addEventListener('mouseleave', () => { isDragging = false; });

dragTarget.addEventListener('touchstart', (e) => {
  startX = e.touches[0].clientX;
  isDragging = true;
}, { passive: true });

dragTarget.addEventListener('touchend', (e) => {
  if (!isDragging) return;
  isDragging = false;
  const diff = e.changedTouches[0].clientX - startX;
  if (diff > 30) move(-1);
  if (diff < -30) move(1);
});

updateCarousel();
