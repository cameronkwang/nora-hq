import type { Customer } from "@/lib/schema";

/** The customer's fields, for New customer and the customer page's Details (server-safe, plain inputs). */
export function CustomerFields({ c }: { c?: Pick<Customer, "name" | "contactName" | "email" | "phone" | "billingAddress" | "notes" | "lang"> }) {
  return (
    <>
      <div>
        <label htmlFor="cus-name" className="label">Name</label>
        <input id="cus-name" name="name" className="input" required maxLength={160} defaultValue={c?.name ?? ""} autoComplete="off" placeholder="Business name, as the invoice prints it" />
      </div>
      <div className="inv-pair">
        <div>
          <label htmlFor="cus-contact" className="label">Contact <span className="font-normal text-muted">(optional)</span></label>
          <input id="cus-contact" name="contactName" className="input" maxLength={120} defaultValue={c?.contactName ?? ""} autoComplete="off" />
        </div>
        <div>
          <label htmlFor="cus-email" className="label">Email <span className="font-normal text-muted">(optional)</span></label>
          <input id="cus-email" name="email" type="email" inputMode="email" className="input" maxLength={200} defaultValue={c?.email ?? ""} autoComplete="off" />
        </div>
      </div>
      <div className="inv-pair">
        <div>
          <label htmlFor="cus-phone" className="label">Phone <span className="font-normal text-muted">(optional)</span></label>
          <input id="cus-phone" name="phone" type="tel" className="input" maxLength={40} defaultValue={c?.phone ?? ""} autoComplete="off" />
        </div>
        <div>
          <label htmlFor="cus-lang" className="label">Language</label>
          <select id="cus-lang" name="lang" className="input" defaultValue={c?.lang ?? "en"}>
            <option value="en">English</option>
            <option value="zh-Hans">简体中文</option>
            <option value="zh-Hant">繁體中文</option>
          </select>
        </div>
      </div>
      <div>
        <label htmlFor="cus-addr" className="label">Billing address <span className="font-normal text-muted">(printed on the PDF)</span></label>
        <textarea id="cus-addr" name="billingAddress" rows={2} className="input min-h-0!" maxLength={500} defaultValue={c?.billingAddress ?? ""} placeholder={"Street\nCity, state ZIP"} />
      </div>
      <div>
        <label htmlFor="cus-notes" className="label">Notes <span className="font-normal text-muted">(only you two see these)</span></label>
        <textarea id="cus-notes" name="notes" rows={2} className="input min-h-0!" maxLength={3000} defaultValue={c?.notes ?? ""} />
      </div>
    </>
  );
}
