use super::form::{CreateFamilyInput, UpdateFamilyInput, VersionInput};
use crate::family::Family;
use topcoat::{
    Result,
    context::Cx,
    router::{
        content::Form,
        error::{SeeOther, bad_request, not_found, see_other},
        page, path_param,
    },
};

path_param!(family_id: i64, error = not_found);

#[page(POST "/families")]
async fn create_family(cx: &Cx, Form(input): Form<CreateFamilyInput>) -> Result<()> {
    let name = validate_name(input.name)?;
    let summary = normalize_summary(input.summary);
    let mut db = crate::db::connect(cx).await?;

    Family::create_record(&mut db, name, summary).await?;

    Err(see_other("/families").into())
}

#[page(POST "/families/{family_id}")]
async fn update_family(cx: &Cx, Form(input): Form<UpdateFamilyInput>) -> Result<()> {
    let family_id = *path_param::<FamilyId>(cx)?;
    let name = validate_name(input.name)?;
    let summary = normalize_summary(input.summary);
    let mut db = crate::db::connect(cx).await?;
    let Some(mut family) = Family::find_active(&mut db, family_id).await? else {
        return Err(not_found().into());
    };

    if family.version != input.version {
        return Err(edit_conflict(family_id).into());
    }

    if let Err(error) = family.update_details(&mut db, name, summary).await {
        let Some(current) = Family::find_active(&mut db, family_id).await? else {
            return Err(see_other("/families").into());
        };

        if current.version != input.version {
            return Err(edit_conflict(family_id).into());
        }

        return Err(error.into());
    }

    Err(see_other("/families").into())
}

#[page(POST "/families/{family_id}/delete")]
async fn delete_family(cx: &Cx, Form(input): Form<VersionInput>) -> Result<()> {
    let family_id = *path_param::<FamilyId>(cx)?;
    let mut db = crate::db::connect(cx).await?;
    let Some(mut family) = Family::find_active(&mut db, family_id).await? else {
        return Err(not_found().into());
    };

    if family.version != input.version {
        return Err(edit_conflict(family_id).into());
    }

    if let Err(error) = family.soft_delete(&mut db).await {
        let Some(current) = Family::find_active(&mut db, family_id).await? else {
            return Err(see_other("/families").into());
        };

        if current.version != input.version {
            return Err(edit_conflict(family_id).into());
        }

        return Err(error.into());
    }

    Err(see_other("/families").into())
}

#[page(POST "/families/{family_id}/restore")]
async fn restore_family(cx: &Cx, Form(input): Form<VersionInput>) -> Result<()> {
    let family_id = *path_param::<FamilyId>(cx)?;
    let mut db = crate::db::connect(cx).await?;
    let Some(mut family) = Family::find_deleted(&mut db, family_id).await? else {
        if Family::find_active(&mut db, family_id).await?.is_some() {
            return Err(see_other("/families").into());
        }
        return Err(not_found().into());
    };

    if family.version != input.version {
        return Err(see_other("/families/deleted?conflict=true").into());
    }

    if let Err(error) = family.restore(&mut db).await {
        let Some(current) = Family::find_deleted(&mut db, family_id).await? else {
            return Err(see_other("/families").into());
        };

        if current.version != input.version {
            return Err(see_other("/families/deleted?conflict=true").into());
        }

        return Err(error.into());
    }

    Err(see_other("/families").into())
}

fn validate_name(name: String) -> Result<String> {
    let name = name.trim();
    if name.is_empty() {
        return Err(bad_request("Name is required").into());
    }

    Ok(name.to_owned())
}

fn normalize_summary(summary: Option<String>) -> Option<String> {
    summary.and_then(|summary| {
        let summary = summary.trim();
        if summary.is_empty() {
            None
        } else {
            Some(summary.to_owned())
        }
    })
}

fn edit_conflict(family_id: i64) -> SeeOther {
    see_other(format!("/families/{family_id}/edit?conflict=true"))
}
