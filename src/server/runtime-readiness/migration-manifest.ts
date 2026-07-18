export type MigrationManifestEntry = Readonly<{
  migrationName: string;
  checksum: string;
}>;

function migration(
  migrationName: string,
  checksum: string
): MigrationManifestEntry {
  return Object.freeze({ migrationName, checksum });
}

export const migrationManifest: readonly MigrationManifestEntry[] = Object.freeze([
  migration(
    "20260701163000_init",
    "ffe797b035d27567d3983d3d887ac77ed63475a22a756c3d410b1836a09d13f8"
  ),
  migration(
    "20260701234000_add_mock_payment_provider",
    "5de68da79ae7e926664451b48e919e1b78376d827f1c09f779a70aa092210312"
  ),
  migration(
    "20260702003000_add_started_attempt_unique_index",
    "79478d828cff60c236e31e5f5a9ed7a6ed8330201622329d123a661ecd6b8483"
  ),
  migration(
    "20260709120000_prepare_expresspay_epos_payments",
    "e8a5c9c8d7f996cf0a9972e3d6157bc38e8878b1071174d230e4b48cf8630831"
  ),
  migration(
    "20260709130000_seed_rikz_2026_russian_scale",
    "c24f1bc12dd78817ee9d0e22e572d54c6d869f87ce9855d850e58c9e30a3e9e2"
  ),
  migration(
    "20260709205000_add_rikz_russian_2026_exam_mode",
    "ab9c8cc5dfdde7e98e96882d4bd497aafa84ca8d15773fd8911cfbbed04a796e"
  ),
  migration(
    "20260711000000_add_commercial_webpay_sandbox_checkout",
    "681b0abaa34208931c6cae06310ecf02b98059de5d841a1cc2347c991084c1f6"
  ),
  migration(
    "20260711120000_harden_commercial_payment_integrity",
    "e2ce4ec84bcbc0f903b49cc0f3d1fb236bec071aff80a2526acebb5d8e9b46df"
  ),
  migration(
    "20260711160000_enforce_commercial_order_concurrency",
    "6f4ec339abb3461b1d80f1a446d8872c31bb9fb12874e932f769ebeb46903c85"
  ),
  migration(
    "20260712120000_add_backend_analytics_payment_access_slice",
    "9939df0e79f4326ed224e6a6109d319c7919e69dbf3bb96115dedc92af81b15d"
  ),
  migration(
    "20260712160000_add_checkout_flow_order_linkage",
    "af58120cd4d49f99e247e8df60d776dceeed7b438d5b17db46d7a5ff16a501ac"
  ),
  migration(
    "20260713180000_add_verified_student_session_foundation",
    "144cdb6b37c40c8eb552857d9f7d6e625f9c9331476c386ac0175ff98d2a5d28"
  ),
  migration(
    "20260713220000_add_acc01a_recovery_domain_foundation",
    "3808c69b35454ab5853e7b93f2e906c65498269dcb385543f8f660c049161925"
  ),
  migration(
    "20260714190000_add_recovery_continuation_exchange",
    "6d6730ce25bfd437b6194b86203aadc2162995eae30eb97688967745c5d471c3"
  )
]);
