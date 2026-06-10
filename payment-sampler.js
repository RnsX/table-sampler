#!/usr/bin/env node

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const REQUIRED_COLUMNS = [
  "OriginatorName",
  "OriginatorAddress",
  "OriginatorAddressCountry",
  "OriginatorBIC",
  "BeneficiaryName",
  "BeneficiaryAddress",
  "BeneficiaryAddressCountry",
  "BeneficiaryBIC",
  "PaymentDetails",
];

function parseCsv(input) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];

    if (inQuotes) {
      if (character === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        inQuotes = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      if (field.length !== 0) {
        throw new Error(`Unexpected quote at character ${index + 1}`);
      }
      inQuotes = true;
    } else if (character === ";") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (character !== "\r") {
      field += character;
    }
  }

  if (inQuotes) {
    throw new Error("CSV contains an unterminated quoted field");
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function countryElement(value) {
  return value.trim() === "" ? "" : `\n          <Ctry>${escapeXml(value)}</Ctry>`;
}

function createPaymentXml(values) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08">
  <FIToFICstmrCdtTrf>
    <GrpHdr>
      <MsgId>MSG-1779817505436-1</MsgId>
      <CreDtTm>2026-05-26T17:45:05.436Z</CreDtTm>
      <NbOfTxs>1</NbOfTxs>
      <SttlmInf>
        <SttlmMtd>CLRG</SttlmMtd>
      </SttlmInf>
    </GrpHdr>
    <CdtTrfTxInf>
      <PmtId>
        <InstrId>SCTINST-1779817505436-1</InstrId>
        <EndToEndId>SCTINST-1779817505436-1</EndToEndId>
        <TxId>SCTINST-1779817505436-1</TxId>
      </PmtId>
      <PmtTpInf>
        <SvcLvl>
          <Cd>SEPA</Cd>
        </SvcLvl>
        <LclInstrm>
          <Cd>INST</Cd>
        </LclInstrm>
      </PmtTpInf>
      <IntrBkSttlmAmt Ccy="EUR">24968.14</IntrBkSttlmAmt>
      <IntrBkSttlmDt>2026-05-26</IntrBkSttlmDt>
      <Dbtr>
        <Nm>${escapeXml(values.OriginatorName)}</Nm>
        <PstlAdr>
          <AdrLine>${escapeXml(values.OriginatorAddress)}</AdrLine>${countryElement(values.OriginatorAddressCountry)}
        </PstlAdr>
      </Dbtr>
      <DbtrAcct>
        <Id>
          <IBAN>LV97BANK53764076263119</IBAN>
        </Id>
      </DbtrAcct>
      <DbtrAgt>
        <FinInstnId>
          <BICFI>${escapeXml(values.OriginatorBIC)}</BICFI>
        </FinInstnId>
      </DbtrAgt>
      <CdtrAgt>
        <FinInstnId>
          <BICFI>${escapeXml(values.BeneficiaryBIC)}</BICFI>
        </FinInstnId>
      </CdtrAgt>
      <Cdtr>
        <Nm>${escapeXml(values.BeneficiaryName)}</Nm>
        <PstlAdr>
          <AdrLine>${escapeXml(values.BeneficiaryAddress)}</AdrLine>${countryElement(values.BeneficiaryAddressCountry)}
        </PstlAdr>
      </Cdtr>
      <CdtrAcct>
        <Id>
          <IBAN>LV97BANK85425591454967</IBAN>
        </Id>
      </CdtrAcct>
      <RmtInf>
        <Ustrd>${escapeXml(values.PaymentDetails)}</Ustrd>
      </RmtInf>
    </CdtTrfTxInf>
  </FIToFICstmrCdtTrf>
</Document>`;
}

function convert(input) {
  const rows = parseCsv(input.replace(/^\uFEFF/, ""));

  while (rows.length > 0 && rows.at(-1).every((value) => value === "")) {
    rows.pop();
  }

  if (rows.length === 0) {
    throw new Error("Input CSV is empty");
  }

  const headers = rows[0].map((header) => header.trim());
  const duplicateHeaders = headers.filter(
    (header, index) => headers.indexOf(header) !== index,
  );
  if (duplicateHeaders.length > 0) {
    throw new Error(`Duplicate CSV column: ${duplicateHeaders[0]}`);
  }

  const missingColumns = REQUIRED_COLUMNS.filter(
    (column) => !headers.includes(column),
  );
  if (missingColumns.length > 0) {
    throw new Error(`Missing required CSV columns: ${missingColumns.join(", ")}`);
  }

  const outputRows = [];
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (row.length !== headers.length) {
      throw new Error(
        `CSV row ${rowIndex + 1} has ${row.length} fields; expected ${headers.length}`,
      );
    }

    const values = Object.fromEntries(
      headers.map((header, columnIndex) => [header, row[columnIndex]]),
    );
    const base64 = Buffer.from(createPaymentXml(values), "utf8").toString("base64");
    outputRows.push(base64);
  }

  return `${outputRows.join("\n")}\n`;
}

function main() {
  const [, , inputFile, outputFile] = process.argv;
  if (!inputFile || process.argv.length > 4) {
    console.error("Usage: node payment-sampler.js <input.csv> [output.csv]");
    process.exitCode = 1;
    return;
  }

  const resolvedOutput =
    outputFile ??
    path.join(
      path.dirname(inputFile),
      `${path.basename(inputFile, path.extname(inputFile))}-payments.csv`,
    );

  try {
    const input = fs.readFileSync(inputFile, "utf8");
    fs.writeFileSync(resolvedOutput, convert(input), "utf8");
    console.log(`Generated ${resolvedOutput}`);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  }
}

main();
