document.addEventListener('DOMContentLoaded', () => {
  const search = document.getElementById('catalogSearch');
  const category = document.getElementById('catalogCategory');
  const sort = document.getElementById('catalogSort');
  const grid = document.getElementById('catalogGrid');

  if (search && category && sort && grid) {
    const cards = Array.from(grid.querySelectorAll('.searchable'));
    function applyFilters() {
      const query = search.value.trim().toLowerCase();
      const categoryValue = category.value;
      let visible = cards.filter(card => {
        const okSearch = !query || card.dataset.search.includes(query);
        const okCategory = categoryValue === 'all' || card.dataset.category === categoryValue;
        card.style.display = okSearch && okCategory ? '' : 'none';
        return okSearch && okCategory;
      });
      visible.sort((a, b) => {
        if (sort.value === 'price-asc') return Number(a.dataset.price) - Number(b.dataset.price);
        if (sort.value === 'price-desc') return Number(b.dataset.price) - Number(a.dataset.price);
        if (sort.value === 'newest') return new Date(b.dataset.created) - new Date(a.dataset.created);
        return Number(b.dataset.featured) - Number(a.dataset.featured);
      });
      visible.forEach(card => grid.appendChild(card));
    }
    [search, category, sort].forEach(el => el.addEventListener('input', applyFilters));
    category.addEventListener('change', applyFilters);
    sort.addEventListener('change', applyFilters);
  }

  document.querySelectorAll('.copy-btn').forEach(button => {
    button.addEventListener('click', async () => {
      const value = button.dataset.copy || '';
      if (!value) return;
      try {
        await navigator.clipboard.writeText(value);
        const original = button.textContent;
        button.textContent = 'Copiado';
        setTimeout(() => button.textContent = original, 1500);
      } catch {
        alert('No se pudo copiar automáticamente.');
      }
    });
  });

  document.querySelectorAll('[data-close-infobox]').forEach(button => {
    button.addEventListener('click', () => button.closest('.infobox')?.remove());
  });
});
