use percent_encoding::{AsciiSet, NON_ALPHANUMERIC, utf8_percent_encode};
use std::{collections::BTreeMap, error::Error, fmt::Write, path::Path};

const IMMUTABLE_CACHE_SECONDS: u32 = 365 * 24 * 60 * 60;

// Workers Static Assets canonicalizes each path segment with encodeURIComponent.
// Keep its unescaped characters, including the wildcard in generated patterns.
const COMPONENT: &AsciiSet = &NON_ALPHANUMERIC
    .remove(b'-')
    .remove(b'_')
    .remove(b'.')
    .remove(b'!')
    .remove(b'~')
    .remove(b'*')
    .remove(b'\'')
    .remove(b'(')
    .remove(b')');

/// Group only unambiguous extensions. This keeps large bundles below Workers'
/// 100-rule limit while retaining per-file content types when extensions clash.
pub fn generate<'a>(
    assets: impl Iterator<Item = (&'a str, &'a str)>,
) -> Result<String, Box<dyn Error>> {
    let mut files = BTreeMap::new();
    for (file, content_type) in assets {
        if file.is_empty()
            || file.chars().any(char::is_control)
            || file.contains(['/', '\\', '*', ':', '?', '#', '%'])
            || content_type.contains(['\r', '\n'])
        {
            return Err("invalid filename or content type in generated asset catalog".into());
        }
        if files
            .insert(file, content_type)
            .is_some_and(|previous| previous != content_type)
        {
            return Err(format!("conflicting content types for bundled asset {file}").into());
        }
    }
    let mut groups = BTreeMap::<_, Vec<_>>::new();
    for (file, content_type) in files {
        let extension = Path::new(file).extension().and_then(|value| value.to_str());
        groups
            .entry(extension)
            .or_default()
            .push((file, content_type));
    }
    let mut headers = String::new();
    for (extension, entries) in groups {
        let content_type = entries[0].1;
        if let Some(extension) =
            extension.filter(|_| entries.iter().all(|entry| entry.1 == content_type))
        {
            rule(&mut headers, &format!("*.{extension}"), content_type)?;
        } else {
            for (file, content_type) in entries {
                rule(&mut headers, file, content_type)?;
            }
        }
    }
    Ok(headers)
}

fn rule(headers: &mut String, pattern: &str, content_type: &str) -> std::fmt::Result {
    let pattern = utf8_percent_encode(pattern, COMPONENT);
    writeln!(
        headers,
        "/_topcoat/assets/{pattern}\n  Content-Type: {content_type}\n  Cache-Control: public, max-age={IMMUTABLE_CACHE_SECONDS}, immutable\n  X-Content-Type-Options: nosniff\n"
    )
}

#[cfg(test)]
mod tests {
    use super::generate;

    #[test]
    fn hundreds_of_stylesheets_fit_in_one_header_rule() {
        let names: Vec<_> = (0..250).map(|i| format!("style-{i}.css")).collect();
        let headers = generate(names.iter().map(|name| (name.as_str(), "text/css"))).unwrap();
        assert_eq!(
            headers.lines().filter(|line| line.starts_with('/')).count(),
            1
        );
        assert!(headers.starts_with("/_topcoat/assets/*.css\n"));
    }

    #[test]
    fn shared_extensions_keep_distinct_types_without_duplicate_rules() {
        let headers = generate(
            [
                ("a.dat", "application/a"),
                ("b.dat", "application/b"),
                ("a.dat", "application/a"),
            ]
            .into_iter(),
        )
        .unwrap();
        assert!(!headers.contains("*.dat"));
        assert!(headers.contains("a.dat\n  Content-Type: application/a"));
        assert!(headers.contains("b.dat\n  Content-Type: application/b"));
        assert_eq!(
            headers.lines().filter(|line| line.starts_with('/')).count(),
            2
        );
    }

    #[test]
    fn unicode_names_match_the_platforms_canonical_asset_paths() {
        let headers = generate(
            [
                ("café@2x.data", "application/custom"),
                ("other.data", "application/other"),
            ]
            .into_iter(),
        )
        .unwrap();
        assert!(headers.contains("/_topcoat/assets/caf%C3%A9%402x.data\n"));
    }
}
