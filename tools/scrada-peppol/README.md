# Scrada Peppol UBL Sender

This PowerShell 5+ script:
1) patches a UBL 2.1 **Invoice** to meet **PEPPOL BIS Billing 3.0** header rules,
2) posts it to Scrada (test or prod),
3) polls until a terminal status.

## Env / Secrets

- `SCRADA_COMPANY_ID`, `SCRADA_API_KEY`, `SCRADA_API_PASSWORD`
- `SCRADA_PEPPOL_SENDER_ID`, `SCRADA_PEPPOL_RECEIVER_ID`

## Local example

```powershell
pwsh ./tools/scrada-peppol/Send-PeppolUbl.ps1 `
  -InputPath .\invoice_peppol_bis3.xml `
  -Environment test `
  -BuyerReference 'BR-REF-001'   # or -OrderId 'PO-12345'
  -DueInDays 30                  # auto-insert DueDate when neither DueDate nor PaymentTerms exist
```
