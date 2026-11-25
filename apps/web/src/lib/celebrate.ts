// FEAT-033: small celebrations (the done stamp, the first receipt printing) are on unless this browser turned them
// off on the Account page. A display preference only: a cookie, never sent anywhere else.
export const CELEBRATE_COOKIE = "codeceipt_celebrate";
export const celebrationsOn = (value: string | undefined) => value !== "off";
