use rand::RngExt;
use serde::{Deserialize, Serialize};
use topcoat::{Result, router::error::bad_request};

pub const QUESTION_COUNT: usize = 5;
const MAX_QUESTION_BYTES: usize = 2_000;
const MAX_ANSWER_BYTES: usize = 500;
const MAX_ANSWERS: usize = 8;
const MAX_QUIZ_BYTES: usize = 32 * 1024;

#[derive(Deserialize)]
pub struct QuizApiResponse {
    pub quizzes: Vec<ApiQuestion>,
}

#[derive(Deserialize)]
pub struct ApiQuestion {
    pub question: String,
    #[serde(rename = "badAnswers")]
    pub bad_answers: Vec<String>,
    pub answer: String,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct Question {
    pub question: String,
    pub answers: Vec<String>,
    pub answer: usize,
}

impl From<ApiQuestion> for Question {
    fn from(value: ApiQuestion) -> Self {
        let position = rand::rng().random_range(0..=value.bad_answers.len());
        let mut answers = value.bad_answers;
        answers.insert(position, value.answer);
        Self {
            question: value.question,
            answers,
            answer: position,
        }
    }
}

pub fn validate_questions(questions: &[Question]) -> Result<()> {
    let valid = questions.len() == QUESTION_COUNT
        && questions.iter().all(|question| {
            !question.question.trim().is_empty()
                && question.question.len() <= MAX_QUESTION_BYTES
                && (2..=MAX_ANSWERS).contains(&question.answers.len())
                && question.answer < question.answers.len()
                && question
                    .answers
                    .iter()
                    .all(|answer| !answer.trim().is_empty() && answer.len() <= MAX_ANSWER_BYTES)
        });
    if !valid {
        return Err(bad_request("Invalid quiz questions").into());
    }
    Ok(())
}

pub fn decode_questions(json: &str) -> Result<Vec<Question>> {
    if json.len() > MAX_QUIZ_BYTES {
        return Err(bad_request("Quiz data is too large").into());
    }
    let questions: Vec<Question> =
        serde_json::from_str(json).map_err(|_| bad_request("Invalid quiz data"))?;
    validate_questions(&questions)?;
    Ok(questions)
}
