// Choosing a product's option shows that variant's price and stock straight away (theme/pages/product.html).
document.querySelectorAll("#options select").forEach((s) => s.addEventListener("change", () => s.form.submit()))
