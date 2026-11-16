// The checkout's payment fields (theme/pages/checkout.html). Card details go straight to Stripe
// from its own field, never through the shop. PayPal's buttons approve the order the shop made;
// the shop then completes it.
const sf = document.getElementById("stripe-form")
if (sf && window.Stripe) {
  const stripe = window.Stripe(sf.dataset.key)
  const elements = stripe.elements({ clientSecret: sf.dataset.secret })
  elements.create("payment").mount("#stripe-element")
  sf.addEventListener("submit", async (e) => {
    e.preventDefault()
    const button = sf.querySelector("button")
    button.disabled = true
    const { error } = await stripe.confirmPayment({ elements, confirmParams: { return_url: sf.dataset.return } })
    document.getElementById("stripe-error").textContent = error?.message ?? ""
    button.disabled = false
  })
}
const pp = document.getElementById("paypal")
if (pp && window.paypal) {
  window.paypal
    .Buttons({
      createOrder: () => pp.dataset.order,
      onApprove: async () => {
        const res = await fetch("/checkout/complete", { method: "POST", headers: { accept: "application/json" } })
        const out = await res.json()
        if (out.location) location.href = out.location
        else document.getElementById("paypal-error").textContent = out.error ?? "The payment didn't go through."
      },
      onError: () => (document.getElementById("paypal-error").textContent = "PayPal couldn't take the payment. Try again or pay another way."),
    })
    .render("#paypal-buttons")
}
