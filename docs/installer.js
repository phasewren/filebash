const platformText = (navigator.userAgentData?.platform || navigator.platform || navigator.userAgent || '').toLowerCase();
const platform = platformText.includes('mac') ? 'mac' : platformText.includes('win') ? 'windows' : '';

if (platform) document.querySelector(`[data-platform="${platform}"]`)?.classList.add('recommended');

document.querySelectorAll('.download-btn').forEach(button => {
  button.addEventListener('click', () => {
    const status = document.getElementById('downloadStatus');
    const operatingSystem = button.closest('[data-platform]')?.dataset.platform === 'mac' ? 'Mac' : 'Windows';
    status.textContent = `Your File Bash download for ${operatingSystem} is starting.`;
  });
});
