import React from "react";
(globalThis as Record<string, unknown>).React = React;
import assert from "node:assert/strict";
import { it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nProvider } from "../components/i18n-provider.tsx";
import { AdminUsers } from "../components/admin-users.tsx";
import { AuthForm } from "../components/auth-form.tsx";
import { catalogFor } from "../src/i18n/catalog.ts";

const users = [
  { id: "1", username: "root", createdAt: "2026-01-01T00:00:00.000Z" },
  { id: "2", username: "learner", createdAt: "2026-02-01T00:00:00.000Z" },
];

for (const language of ["en", "ja"] as const) {
  it(`renders the user list in ${language}; no delete for admins`, () => {
    const copy = catalogFor(language).admin;
    const html = renderToStaticMarkup(<I18nProvider language={language}><AdminUsers initialUsers={users} adminUsername="root" /></I18nProvider>);
    for (const text of [copy.title, "root", "learner", copy.admin, copy.user, copy.resetPassword]) assert.ok(html.includes(text), text);
    assert.equal(html.split(`${copy.delete}: `).length - 1, 1, "delete button only for the non-admin user");
    assert.ok(html.includes(`${copy.delete}: learner`));
    assert.ok(!html.includes("undefined"));
  });
}

it("login form shows the forgot-password hint; signup does not", () => {
  const login = renderToStaticMarkup(<AuthForm mode="login" initialLanguage="en" />);
  assert.ok(login.includes(catalogFor("en").auth.forgotPassword));
  assert.ok(!login.includes("<a href=\"/forgot"));
  assert.ok(!renderToStaticMarkup(<AuthForm mode="signup" initialLanguage="en" />).includes(catalogFor("en").auth.forgotPassword));
});
