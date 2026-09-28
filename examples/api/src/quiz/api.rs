use std::time::Duration;

use topcoat::{Result, context::Cx};

use super::model::{QUESTION_COUNT, Question, QuizApiResponse, validate_questions};

const UPSTREAM_TIMEOUT: Duration = Duration::from_secs(5);

pub async fn fetch_questions(cx: &Cx) -> Result<Vec<Question>> {
    let endpoint = topcoat_cloudflare::env(cx).var("QUIZ_API_URL")?.to_string();
    let response = worker::send::SendFuture::new(async move {
        reqwest::Client::new()
            .get(endpoint)
            .query(&[
                ("limit", QUESTION_COUNT.to_string()),
                ("difficulty", "facile".into()),
            ])
            .timeout(UPSTREAM_TIMEOUT)
            .send()
            .await?
            .error_for_status()?
            .json::<QuizApiResponse>()
            .await
    })
    .await?;
    let questions: Vec<Question> = response.quizzes.into_iter().map(Into::into).collect();
    validate_questions(&questions)?;
    Ok(questions)
}
