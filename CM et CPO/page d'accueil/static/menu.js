const devices = Array.from(document.querySelectorAll('.device'));
const labelDisplay = document.getElementById('selected-label');
const carouselWrapper = document.querySelector('.carousel-wrapper');
const dragTarget = carouselWrapper || document.body;

let currentIndex = devices.findIndex(d => d.dataset.label === (labelDisplay?.textContent || ''));
if (currentIndex < 0) currentIndex = 0;
let lastIndex = currentIndex;

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
  d.addEventListener('click', () => { currentIndex = i; updateCarousel(); });
  d.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      currentIndex = i;
      updateCarousel();
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

