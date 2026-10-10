/** A street/door number remains location evidence even next to phone/postcode. */
export function hasStreetAddress(text: string) {
  return (
    /地址|校址|校区/.test(text) &&
    /[\p{Script=Han}]{1,25}(?:路|街|巷|道|弄|村)\s*\d+(?:[-－]\d+)?\s*号/u.test(
      text,
    ) &&
    !/邮寄|寄送|收件|寄件|录取通知书|家庭地址/.test(text)
  );
}
