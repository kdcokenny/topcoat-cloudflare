use crate::family::Family;
use toasty::stmt::Page;

/// Builds the cursor URLs used by the families page.
pub(super) trait FamilyPageNavigation {
    fn previous_url(&self) -> Option<String>;
    fn next_url(&self) -> Option<String>;
}

impl FamilyPageNavigation for Page<Family> {
    fn previous_url(&self) -> Option<String> {
        if !self.has_prev() {
            return None;
        }

        self.first().map(|family| format!("?before={}", family.id))
    }

    fn next_url(&self) -> Option<String> {
        if !self.has_next() {
            return None;
        }

        self.last().map(|family| format!("?after={}", family.id))
    }
}
