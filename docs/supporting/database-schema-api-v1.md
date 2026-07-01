# **Database Schema \+ API v1**

## **1\. Назначение документа**

Документ описывает структуру базы данных и API для MVP веб\-сервиса онлайн-тестов по русскому языку для подготовки к ЦЭ/ЦТ.

Документ обновлён под MVP v1.1 и учитывает:

1. русский язык как первый предмет;  
2. тренировочный режим и режим ЦЭ/ЦТ;  
3. ручное создание тестов;  
4. импорт Excel/CSV;  
5. три типа вопросов:

   * один правильный ответ;  
   * несколько правильных ответов;  
   * короткий текстовый ответ;  
6. оплату одного теста;  
7. ручную выдачу доступа;  
8. одноразовые коды доступа;  
9. попытки прохождения;  
10. snapshot теста;  
11. автоматический расчёт результата;  
12. результат по темам;  
13. правильные ответы после завершения;  
14. админку оплат, доступов, кодов и результатов.

---

## **2\. Общие технические принципы**

## **2.1. База данных**

Рекомендуемая база данных:

PostgreSQL.

Рекомендуемый ORM:

Prisma.

---

## **2.2. ID**

Все основные сущности должны иметь поле:

`id`

Рекомендуемый тип:

UUID.

---

## **2.3. Даты**

Все даты хранить в UTC.

Стандартные поля:

1. `created_at`;  
2. `updated_at`;  
3. `deleted_at`, если нужна soft delete.

---

## **2.4. Soft delete**

Для важных сущностей лучше использовать soft delete:

1. users;  
2. tests;  
3. questions.

Физически удалять данные не рекомендуется, потому что старые результаты должны сохраняться.

---

## **2.5. Snapshot**

При старте попытки обязательно создаётся snapshot теста.

Snapshot нужен, чтобы:

1. старые результаты не ломались после редактирования теста;  
2. ответы ученика проверялись по версии теста на момент старта;  
3. правильные ответы и баллы не менялись задним числом.

---

## **2.6. Результат считается только на backend**

Frontend не должен сам считать итоговый результат.

Backend отвечает за:

1. проверку ответов;  
2. начисление баллов;  
3. расчёт процента;  
4. расчёт результата по темам;  
5. расчёт рекомендаций;  
6. расчёт тестового балла 0-100, если подключена шкала.

---

## **2.7. Правильные ответы нельзя отдавать до завершения**

Во время прохождения теста API не должен возвращать ученику:

1. `correct_answer`;  
2. `is_correct`;  
3. `points_earned`;  
4. правильные варианты;  
5. explanation, если оно раскрывает ответ.

Эти данные можно вернуть только после завершения попытки.

---

# **3\. Enum-значения**

## **3.1. UserRole**

admin  
student  
---

## **3.2. TestStatus**

draft  
published  
hidden  
archived  
---

## **3.3. Subject**

В первой версии:

russian

Но архитектурно поле должно позволять добавить другие предметы.

---

## **3.4. TestMode**

training  
ce\_ct  
---

## **3.5. QuestionType**

single\_choice  
multiple\_choice  
short\_text  
---

## **3.6. Difficulty**

easy  
medium  
hard  
---

## **3.7. PaymentStatus**

pending  
success  
failed  
cancelled  
refunded  
---

## **3.8. PaymentProvider**

Пока провайдер не выбран, но enum можно заложить так:

manual  
bepaid  
webpay  
erip  
stripe  
other

Финальный список зависит от выбранного провайдера.

---

## **3.9. AccessSource**

payment  
manual  
access\_code  
promo

В MVP используются:

payment  
manual  
access\_code

`promo` можно заложить на будущее.

---

## **3.10. AccessCodeStatus**

active  
used  
expired  
revoked  
---

## **3.11. AttemptStatus**

started  
completed  
expired  
cancelled  
---

## **3.12. ImportJobStatus**

uploaded  
validated  
failed  
imported  
cancelled  
---

## **3.13. ScoringRule**

full\_match  
exact\_text  
manual  
partial\_match

В MVP используются:

full\_match  
exact\_text

`manual` и `partial_match` закладываются на будущее.

---

## **3.14. EmailStatus**

pending  
sent  
failed  
---

# **4\. Database Schema**

---

# **4.1. users**

Хранит администраторов и учеников.

## **Поля**

id uuid primary key

email varchar unique not null  
name varchar nullable

role UserRole not null

password\_hash varchar nullable

created\_at timestamp not null  
updated\_at timestamp not null  
deleted\_at timestamp nullable

## **Правила**

1. У админа должен быть `password_hash`.  
2. У ученика `password_hash` может быть пустым, потому что в MVP ученик входит без пароля.  
3. Email хранить в lowercase.  
4. Email перед сохранением нормализовать: trim \+ lowercase.

## **Индексы**

unique index users\_email\_unique on users(email)  
index users\_role\_idx on users(role)  
---

# **4.2. tests**

Хранит тесты.

## **Поля**

id uuid primary key

title varchar not null  
slug varchar unique not null

subject varchar not null default 'russian'  
mode TestMode not null default 'training'

short\_description text nullable  
full\_description text nullable

price integer not null  
currency varchar not null default 'BYN'

duration\_minutes integer not null

attempts\_limit integer not null default 1  
access\_days integer not null default 7

status TestStatus not null default 'draft'

questions\_count integer not null default 0  
max\_raw\_score integer not null default 0

scoring\_scheme\_id uuid nullable  
show\_scaled\_score boolean not null default false  
show\_percent boolean not null default true  
show\_correct\_answers boolean not null default true  
show\_topic\_result boolean not null default true  
show\_recommendations boolean not null default true

published\_at timestamp nullable

created\_by\_admin\_id uuid nullable

created\_at timestamp not null  
updated\_at timestamp not null  
deleted\_at timestamp nullable

## **Связи**

tests.created\_by\_admin\_id \-\> users.id  
tests.scoring\_scheme\_id \-\> scoring\_schemes.id

## **Правила**

1. В MVP `subject = russian`.  
2. `mode` может быть `training` или `ce_ct`.  
3. `price` хранить в минимальных единицах валюты, например копейках.  
4. `questions_count` пересчитывать после изменения вопросов.  
5. `max_raw_score` пересчитывать после изменения вопросов.  
6. `slug` должен быть уникальным.  
7. Published тест виден ученикам.  
8. Draft и hidden тесты не видны в публичном каталоге.

## **Индексы**

unique index tests\_slug\_unique on tests(slug)  
index tests\_status\_idx on tests(status)  
index tests\_subject\_idx on tests(subject)  
index tests\_mode\_idx on tests(mode)  
---

# **4.3. questions**

Хранит вопросы тестов.

## **Поля**

id uuid primary key

test\_id uuid not null

question\_text text not null  
question\_type QuestionType not null

option\_a text nullable  
option\_b text nullable  
option\_c text nullable  
option\_d text nullable

correct\_answer text not null

topic varchar not null  
subtopic varchar nullable

difficulty Difficulty nullable default 'medium'

points integer not null default 1

scoring\_rule ScoringRule not null default 'full\_match'

explanation text nullable  
source text nullable

order\_index integer not null

created\_at timestamp not null  
updated\_at timestamp not null  
deleted\_at timestamp nullable

## **Связи**

questions.test\_id \-\> tests.id

## **Правила**

1. `topic` обязателен.  
2. `points` должен быть больше 0\.  
3. Для `single_choice`:

   * correct\_answer должен быть A/B/C/D;  
   * правильный вариант не должен быть пустым.  
4. Для `multiple_choice`:

   * correct\_answer хранится строкой вида `A,C,D`;  
   * все варианты из correct\_answer должны существовать.  
5. Для `short_text`:

   * correct\_answer хранится строкой;  
   * несколько допустимых ответов разделяются через `;`;  
   * варианты option\_a-d не обязательны.  
6. `order_index` определяет порядок вопросов в тесте.  
7. При удалении вопроса лучше использовать soft delete.

## **Индексы**

index questions\_test\_id\_idx on questions(test\_id)  
index questions\_topic\_idx on questions(topic)  
index questions\_order\_idx on questions(test\_id, order\_index)  
---

# **4.4. payments**

Хранит платежи.

## **Поля**

id uuid primary key

user\_id uuid not null  
test\_id uuid not null

amount integer not null  
currency varchar not null

status PaymentStatus not null default 'pending'

provider PaymentProvider not null  
provider\_payment\_id varchar nullable

provider\_payload\_json jsonb nullable

created\_at timestamp not null  
updated\_at timestamp not null  
paid\_at timestamp nullable  
failed\_at timestamp nullable  
refunded\_at timestamp nullable

## **Связи**

payments.user\_id \-\> users.id  
payments.test\_id \-\> tests.id

## **Правила**

1. Payment создаётся после ввода email и старта оплаты.  
2. После успешного webhook Payment получает `success`.  
3. После `success` создаётся Access.  
4. Повторный webhook не должен создать второй Access.  
5. `provider_payment_id` должен быть уникальным внутри provider, если провайдер его возвращает.

## **Индексы**

index payments\_user\_id\_idx on payments(user\_id)  
index payments\_test\_id\_idx on payments(test\_id)  
index payments\_status\_idx on payments(status)  
index payments\_provider\_payment\_id\_idx on payments(provider, provider\_payment\_id)  
---

# **4.5. accesses**

Хранит права доступа учеников к тестам.

## **Поля**

id uuid primary key

user\_id uuid not null  
test\_id uuid not null

payment\_id uuid nullable  
access\_code\_id uuid nullable

source AccessSource not null

attempts\_total integer not null default 1  
attempts\_available integer not null default 1

expires\_at timestamp not null

revoked\_at timestamp nullable  
revoked\_by\_admin\_id uuid nullable  
revoked\_reason text nullable

created\_by\_admin\_id uuid nullable

created\_at timestamp not null  
updated\_at timestamp not null

## **Связи**

accesses.user\_id \-\> users.id  
accesses.test\_id \-\> tests.id  
accesses.payment\_id \-\> payments.id  
accesses.access\_code\_id \-\> access\_codes.id  
accesses.revoked\_by\_admin\_id \-\> users.id  
accesses.created\_by\_admin\_id \-\> users.id

## **Правила**

1. Access создаётся после:

   * успешной оплаты;  
   * ручной выдачи;  
   * активации одноразового кода.  
2. Access привязан к конкретному пользователю и конкретному тесту.  
3. В MVP 1 Access \= 1 тест.  
4. В MVP по умолчанию:

   * attempts\_total \= 1;  
   * attempts\_available \= 1\.  
5. При старте теста `attempts_available` уменьшается на 1\.  
6. Если доступ истёк, новый тест начать нельзя.  
7. Если доступ истёк во время уже начатой попытки, попытку можно завершить.  
8. Если доступ revoked, старт запрещён.  
9. Статус доступа можно вычислять:

   * active;  
   * expired;  
   * used;  
   * revoked.

## **Индексы**

index accesses\_user\_id\_idx on accesses(user\_id)  
index accesses\_test\_id\_idx on accesses(test\_id)  
index accesses\_user\_test\_idx on accesses(user\_id, test\_id)  
index accesses\_expires\_at\_idx on accesses(expires\_at)  
---

# **4.6. access\_codes**

Хранит одноразовые коды доступа.

## **Поля**

id uuid primary key

code\_hash varchar unique not null

test\_id uuid not null  
created\_by\_admin\_id uuid not null

status AccessCodeStatus not null default 'active'

attempts\_total integer not null default 1  
access\_days integer not null default 7

code\_expires\_at timestamp not null

activated\_by\_user\_id uuid nullable  
activated\_at timestamp nullable

revoked\_at timestamp nullable  
revoked\_by\_admin\_id uuid nullable  
revoked\_reason text nullable

comment text nullable

created\_at timestamp not null  
updated\_at timestamp not null

## **Связи**

access\_codes.test\_id \-\> tests.id  
access\_codes.created\_by\_admin\_id \-\> users.id  
access\_codes.activated\_by\_user\_id \-\> users.id  
access\_codes.revoked\_by\_admin\_id \-\> users.id

## **Правила**

1. Код создаёт администратор.  
2. Код привязан к конкретному тесту.  
3. Код одноразовый.  
4. В базе хранится hash кода, а не сам код.  
5. При активации:

   * код получает status \= used;  
   * создаётся Access;  
   * сохраняется activated\_by\_user\_id;  
   * сохраняется activated\_at.  
6. Повторная активация невозможна.  
7. Код нельзя активировать после `code_expires_at`.  
8. Код нельзя активировать после revoke.

## **Индексы**

unique index access\_codes\_hash\_unique on access\_codes(code\_hash)  
index access\_codes\_test\_id\_idx on access\_codes(test\_id)  
index access\_codes\_status\_idx on access\_codes(status)  
index access\_codes\_expires\_at\_idx on access\_codes(code\_expires\_at)  
---

# **4.7. attempts**

Хранит попытки прохождения тестов.

## **Поля**

id uuid primary key

user\_id uuid not null  
test\_id uuid not null  
access\_id uuid not null

status AttemptStatus not null default 'started'

started\_at timestamp not null  
finished\_at timestamp nullable

duration\_seconds integer nullable

raw\_score integer nullable  
max\_raw\_score integer nullable  
percent numeric nullable

scaled\_score integer nullable  
max\_scaled\_score integer nullable

level varchar nullable

test\_snapshot\_json jsonb not null  
scoring\_scheme\_snapshot\_json jsonb nullable  
topic\_results\_json jsonb nullable  
recommendations\_json jsonb nullable

created\_at timestamp not null  
updated\_at timestamp not null

## **Связи**

attempts.user\_id \-\> users.id  
attempts.test\_id \-\> tests.id  
attempts.access\_id \-\> accesses.id

## **Правила**

1. Attempt создаётся при нажатии “Начать тест”.  
2. При создании attempt создаётся snapshot теста.  
3. При создании attempt списывается попытка из Access.  
4. Пока status \= started, ученик может сохранять и менять ответы.  
5. После completed/expired ответы менять нельзя.  
6. `raw_score`, `percent`, `topic_results_json` заполняются после завершения.  
7. `test_snapshot_json` обязателен.  
8. Правильные ответы есть в snapshot, но не возвращаются ученику до завершения.

## **Индексы**

index attempts\_user\_id\_idx on attempts(user\_id)  
index attempts\_test\_id\_idx on attempts(test\_id)  
index attempts\_access\_id\_idx on attempts(access\_id)  
index attempts\_status\_idx on attempts(status)  
index attempts\_started\_at\_idx on attempts(started\_at)  
---

# **4.8. answers**

Хранит ответы ученика.

## **Поля**

id uuid primary key

attempt\_id uuid not null

question\_id uuid nullable  
snapshot\_question\_id varchar nullable

question\_snapshot\_json jsonb not null

selected\_answer text nullable

is\_correct boolean nullable  
points\_earned integer nullable  
max\_points integer not null

answered\_at timestamp nullable

created\_at timestamp not null  
updated\_at timestamp not null

## **Связи**

answers.attempt\_id \-\> attempts.id  
answers.question\_id \-\> questions.id nullable

## **Правила**

1. Ответ можно создавать/обновлять только пока attempt.status \= started.  
2. После завершения попытки ответы менять нельзя.  
3. `question_snapshot_json` нужен для сохранения версии вопроса.  
4. Для пустого ответа:

   * selected\_answer \= null или пустая строка;  
   * is\_correct \= false;  
   * points\_earned \= 0 после завершения.  
5. `is_correct` и `points_earned` заполняются после завершения попытки.

## **Индексы**

index answers\_attempt\_id\_idx on answers(attempt\_id)  
index answers\_question\_id\_idx on answers(question\_id)  
unique index answers\_attempt\_snapshot\_question\_unique on answers(attempt\_id, snapshot\_question\_id)  
---

# **4.9. import\_jobs**

Хранит операции импорта Excel/CSV.

## **Поля**

id uuid primary key

test\_id uuid not null  
admin\_id uuid not null

file\_name varchar not null  
file\_type varchar not null

mode varchar not null  
status ImportJobStatus not null default 'uploaded'

total\_rows integer nullable  
valid\_rows integer nullable  
error\_rows integer nullable  
warning\_rows integer nullable

errors\_json jsonb nullable  
warnings\_json jsonb nullable  
preview\_json jsonb nullable

created\_at timestamp not null  
updated\_at timestamp not null  
validated\_at timestamp nullable  
imported\_at timestamp nullable

## **Связи**

import\_jobs.test\_id \-\> tests.id  
import\_jobs.admin\_id \-\> users.id

## **Поле mode**

append  
replace

## **Правила**

1. Файл сначала валидируется.  
2. Если есть критические ошибки, импорт запрещён.  
3. Частичный импорт запрещён.  
4. При mode \= append вопросы добавляются к текущим.  
5. При mode \= replace текущие вопросы заменяются новыми.  
6. Старые результаты не меняются, потому что попытки хранят snapshot.

## **Индексы**

index import\_jobs\_test\_id\_idx on import\_jobs(test\_id)  
index import\_jobs\_admin\_id\_idx on import\_jobs(admin\_id)  
index import\_jobs\_status\_idx on import\_jobs(status)  
---

# **4.10. manual\_access\_logs**

Хранит логи ручной выдачи доступа.

## **Поля**

id uuid primary key

admin\_id uuid not null  
user\_id uuid not null  
test\_id uuid not null  
access\_id uuid not null

attempts\_total integer not null  
access\_days integer not null

comment text nullable

created\_at timestamp not null

## **Связи**

manual\_access\_logs.admin\_id \-\> users.id  
manual\_access\_logs.user\_id \-\> users.id  
manual\_access\_logs.test\_id \-\> tests.id  
manual\_access\_logs.access\_id \-\> accesses.id

## **Правила**

1. Каждая ручная выдача доступа должна логироваться.  
2. Лог не редактируется.

---

# **4.11. event\_logs**

Хранит системные события.

## **Поля**

id uuid primary key

actor\_user\_id uuid nullable

event\_type varchar not null  
entity\_type varchar nullable  
entity\_id uuid nullable

payload\_json jsonb nullable

created\_at timestamp not null

## **Примеры event\_type**

test\_created  
test\_published  
question\_created  
import\_validated  
import\_failed  
import\_committed  
payment\_success  
payment\_failed  
access\_created  
manual\_access\_created  
access\_code\_created  
access\_code\_activated  
attempt\_started  
attempt\_completed  
attempt\_expired  
result\_calculated  
webhook\_error

## **Индексы**

index event\_logs\_actor\_user\_id\_idx on event\_logs(actor\_user\_id)  
index event\_logs\_event\_type\_idx on event\_logs(event\_type)  
index event\_logs\_entity\_idx on event\_logs(entity\_type, entity\_id)  
index event\_logs\_created\_at\_idx on event\_logs(created\_at)  
---

# **4.12. scoring\_schemes**

Хранит шкалы оценивания.

Нужно заложить архитектурно. Можно реализовать в MVP или релизе 1.1.

## **Поля**

id uuid primary key

name varchar not null

subject varchar not null  
exam\_type varchar not null

year integer nullable

max\_raw\_score integer not null  
max\_scaled\_score integer not null default 100

is\_active boolean not null default true

created\_at timestamp not null  
updated\_at timestamp not null

## **Примеры**

Русский язык ЦТ 2026  
Русский язык ЦЭ 2026

## **Индексы**

index scoring\_schemes\_subject\_idx on scoring\_schemes(subject)  
index scoring\_schemes\_exam\_type\_idx on scoring\_schemes(exam\_type)  
index scoring\_schemes\_active\_idx on scoring\_schemes(is\_active)  
---

# **4.13. scoring\_scales**

Хранит соответствие первичных баллов и тестовых баллов.

## **Поля**

id uuid primary key

scoring\_scheme\_id uuid not null

raw\_score integer not null  
scaled\_score integer not null

created\_at timestamp not null  
updated\_at timestamp not null

## **Связи**

scoring\_scales.scoring\_scheme\_id \-\> scoring\_schemes.id

## **Правила**

1. В одной шкале не может быть двух записей с одинаковым raw\_score.  
2. scaled\_score должен быть от 0 до max\_scaled\_score.  
3. Должна быть запись для 0\.  
4. Должна быть запись для max\_raw\_score.  
5. Не должно быть пропусков raw\_score, если шкала предполагает полный диапазон.

## **Индексы**

unique index scoring\_scales\_scheme\_raw\_unique on scoring\_scales(scoring\_scheme\_id, raw\_score)  
index scoring\_scales\_scheme\_id\_idx on scoring\_scales(scoring\_scheme\_id)  
---

# **4.14. email\_logs**

Хранит историю отправки email.

## **Поля**

id uuid primary key

user\_id uuid nullable  
email varchar not null

type varchar not null  
status EmailStatus not null default 'pending'

subject text not null  
body text nullable

provider varchar nullable  
provider\_message\_id varchar nullable

error\_message text nullable

sent\_at timestamp nullable

created\_at timestamp not null  
updated\_at timestamp not null

## **Примеры type**

payment\_success  
manual\_access  
access\_code\_activated  
attempt\_completed

## **Правила**

1. Ошибки отправки email не должны ломать создание доступа.  
2. Если email не отправился, нужно сохранить failed-лог.  
3. Админ должен иметь возможность увидеть проблему хотя бы в логах.

---

# **5\. Snapshot structure**

## **5.1. test\_snapshot\_json**

Пример структуры:

{  
  "test\_id": "uuid",  
  "title": "Русский язык. Тренировочный тест №1",  
  "subject": "russian",  
  "mode": "training",  
  "duration\_minutes": 60,  
  "max\_raw\_score": 40,  
  "questions": \[  
    {  
      "snapshot\_question\_id": "q\_1",  
      "original\_question\_id": "uuid",  
      "order\_index": 1,  
      "question\_text": "Укажите правильный вариант...",  
      "question\_type": "single\_choice",  
      "options": {  
        "A": "вариант А",  
        "B": "вариант Б",  
        "C": "вариант В",  
        "D": "вариант Г"  
      },  
      "correct\_answer": "B",  
      "topic": "Орфография",  
      "subtopic": "Н/НН",  
      "points": 1,  
      "scoring\_rule": "full\_match",  
      "explanation": null  
    }  
  \]  
}  
---

## **5.2. Что отдавать ученику во время теста**

Во время прохождения API должен вернуть только:

{  
  "snapshot\_question\_id": "q\_1",  
  "order\_index": 1,  
  "question\_text": "Укажите правильный вариант...",  
  "question\_type": "single\_choice",  
  "options": {  
    "A": "вариант А",  
    "B": "вариант Б",  
    "C": "вариант В",  
    "D": "вариант Г"  
  },  
  "topic": "Орфография"  
}

Нельзя отдавать:

correct\_answer  
points  
scoring\_rule  
explanation  
is\_correct  
---

# **6\. Result structure**

## **6.1. topic\_results\_json**

Пример:

\[  
  {  
    "topic": "Орфография",  
    "score": 6,  
    "max\_score": 10,  
    "percent": 60,  
    "status": "requires\_review"  
  },  
  {  
    "topic": "Пунктуация",  
    "score": 3,  
    "max\_score": 8,  
    "percent": 37.5,  
    "status": "weak"  
  }  
\]

## **Возможные status**

weak  
requires\_review  
normal  
---

## **6.2. recommendations\_json**

Пример:

\[  
  {  
    "topic": "Пунктуация",  
    "subtopics": \["деепричастный оборот", "сложноподчинённое предложение"\],  
    "message": "Повторите пунктуацию в сложных предложениях и конструкциях с деепричастным оборотом."  
  }  
\]  
---

# **7\. API conventions**

## **7.1. Базовый формат ответа**

Успех:

{  
  "success": true,  
  "data": {}  
}

Ошибка:

{  
  "success": false,  
  "error": {  
    "code": "VALIDATION\_ERROR",  
    "message": "Некорректные данные",  
    "details": {}  
  }  
}  
---

## **7.2. HTTP-коды**

200 OK  
201 Created  
400 Bad Request  
401 Unauthorized  
403 Forbidden  
404 Not Found  
409 Conflict  
422 Validation Error  
500 Internal Server Error  
---

## **7.3. Авторизация**

Публичные endpoints доступны без авторизации.

Админские endpoints требуют admin auth.

Ученические endpoints должны проверять:

1. email;  
2. access token или signed token;  
3. attempt ownership.

---

## **7.4. Пагинация**

Для списков использовать:

page  
limit

Ответ:

{  
  "items": \[\],  
  "pagination": {  
    "page": 1,  
    "limit": 20,  
    "total": 100,  
    "total\_pages": 5  
  }  
}  
---

# **8\. Public API**

---

# **8.1. Получить список опубликованных тестов**

GET /api/public/tests

## **Query params**

subject optional  
mode optional  
page optional  
limit optional

## **Response**

{  
  "success": true,  
  "data": {  
    "items": \[  
      {  
        "id": "uuid",  
        "title": "Русский язык. Тренировочный тест №1",  
        "slug": "russian-test-1",  
        "subject": "russian",  
        "mode": "training",  
        "short\_description": "Тренировочный тест по русскому языку",  
        "price": 1500,  
        "currency": "BYN",  
        "duration\_minutes": 60,  
        "attempts\_limit": 1,  
        "access\_days": 7,  
        "questions\_count": 40,  
        "max\_raw\_score": 40  
      }  
    \],  
    "pagination": {}  
  }  
}

## **Правила**

1. Возвращать только `status = published`.  
2. Не возвращать draft, hidden, archived.  
3. Не возвращать правильные ответы и вопросы полностью.

---

# **8.2. Получить страницу теста**

GET /api/public/tests/:slug

## **Response**

{  
  "success": true,  
  "data": {  
    "id": "uuid",  
    "title": "Русский язык. Тренировочный тест №1",  
    "slug": "russian-test-1",  
    "subject": "russian",  
    "mode": "training",  
    "short\_description": "Краткое описание",  
    "full\_description": "Полное описание",  
    "price": 1500,  
    "currency": "BYN",  
    "duration\_minutes": 60,  
    "attempts\_limit": 1,  
    "access\_days": 7,  
    "questions\_count": 40,  
    "max\_raw\_score": 40  
  }  
}

## **Правила**

1. Возвращать только опубликованный тест.  
2. Если тест скрыт или не найден, вернуть 404\.

---

# **9\. Student API**

---

# **9.1. Идентификация ученика по email**

POST /api/students/identify

## **Request**

{  
  "email": "student@example.com",  
  "name": "Иван"  
}

## **Response**

{  
  "success": true,  
  "data": {  
    "user\_id": "uuid",  
    "email": "student@example.com"  
  }  
}

## **Правила**

1. Email обязателен.  
2. Email нормализуется.  
3. Если user существует, вернуть существующего.  
4. Если не существует, создать user с role \= student.  
5. Пароль не нужен.

---

# **9.2. Проверить доступ к тесту**

POST /api/access/check

## **Request**

{  
  "email": "student@example.com",  
  "test\_id": "uuid"  
}

## **Response при активном доступе**

{  
  "success": true,  
  "data": {  
    "has\_access": true,  
    "access\_id": "uuid",  
    "attempts\_available": 1,  
    "expires\_at": "2026-07-05T12:00:00Z"  
  }  
}

## **Response без доступа**

{  
  "success": true,  
  "data": {  
    "has\_access": false,  
    "reason": "ACCESS\_NOT\_FOUND"  
  }  
}

## **Возможные reason**

ACCESS\_NOT\_FOUND  
ACCESS\_EXPIRED  
ACCESS\_USED  
ACCESS\_REVOKED  
TEST\_NOT\_FOUND  
TEST\_NOT\_AVAILABLE  
---

# **9.3. Активация одноразового кода**

POST /api/access-codes/activate

## **Request**

{  
  "code": "RUS-8F3K-21QZ",  
  "email": "student@example.com",  
  "name": "Иван"  
}

## **Response**

{  
  "success": true,  
  "data": {  
    "access\_id": "uuid",  
    "test\_id": "uuid",  
    "test\_slug": "russian-test-1",  
    "attempts\_available": 1,  
    "expires\_at": "2026-07-05T12:00:00Z"  
  }  
}

## **Ошибки**

CODE\_NOT\_FOUND  
CODE\_ALREADY\_USED  
CODE\_EXPIRED  
CODE\_REVOKED  
TEST\_NOT\_FOUND  
TEST\_NOT\_AVAILABLE

## **Правила**

1. Проверять hash кода.  
2. Код можно активировать только один раз.  
3. После активации создать Access.  
4. После активации status кода \= used.  
5. Операция должна быть в transaction.

---

# **10\. Payment API**

---

# **10.1. Создать платёж**

POST /api/payments/create

## **Request**

{  
  "test\_id": "uuid",  
  "email": "student@example.com",  
  "provider": "bepaid",  
  "return\_url": "https://site.com/payment/success",  
  "fail\_url": "https://site.com/payment/fail"  
}

## **Response**

{  
  "success": true,  
  "data": {  
    "payment\_id": "uuid",  
    "status": "pending",  
    "payment\_url": "https://provider-payment-url.com"  
  }  
}

## **Правила**

1. Проверить, что тест опубликован.  
2. Создать или найти student user.  
3. Создать Payment со статусом pending.  
4. Передать данные провайдеру.  
5. Вернуть payment\_url.  
6. Access не создавать до успешной оплаты.

---

# **10.2. Webhook оплаты**

POST /api/payments/webhook/:provider

## **Request**

Зависит от платёжного провайдера.

## **Response**

{  
  "success": true  
}

## **Правила**

1. Проверить подпись webhook.  
2. Найти Payment по provider\_payment\_id или внутреннему payment\_id.  
3. Проверить сумму.  
4. Проверить валюту.  
5. Если оплата успешна:

   * Payment status \= success;  
   * paid\_at \= now;  
   * создать Access, если он ещё не создан;  
   * отправить email.  
6. Если webhook пришёл повторно, второй Access не создавать.  
7. Все действия выполнять идемпотентно.  
8. Ошибки логировать в event\_logs.

---

# **10.3. Проверить статус платежа**

GET /api/payments/:payment\_id/status

## **Response**

{  
  "success": true,  
  "data": {  
    "payment\_id": "uuid",  
    "status": "success",  
    "access\_id": "uuid",  
    "test\_id": "uuid",  
    "test\_slug": "russian-test-1"  
  }  
}  
---

# **11\. Attempt API**

---

# **11.1. Получить данные перед стартом**

GET /api/tests/:test\_id/pre-start?email=student@example.com

## **Response**

{  
  "success": true,  
  "data": {  
    "test\_id": "uuid",  
    "title": "Русский язык. Тренировочный тест №1",  
    "duration\_minutes": 60,  
    "questions\_count": 40,  
    "attempts\_available": 1,  
    "expires\_at": "2026-07-05T12:00:00Z",  
    "can\_start": true  
  }  
}

## **Если нельзя стартовать**

{  
  "success": true,  
  "data": {  
    "can\_start": false,  
    "reason": "ACCESS\_EXPIRED"  
  }  
}  
---

# **11.2. Старт попытки**

POST /api/attempts/start

## **Request**

{  
  "test\_id": "uuid",  
  "email": "student@example.com"  
}

## **Response**

{  
  "success": true,  
  "data": {  
    "attempt\_id": "uuid",  
    "status": "started",  
    "started\_at": "2026-06-28T12:00:00Z",  
    "duration\_minutes": 60,  
    "questions": \[  
      {  
        "snapshot\_question\_id": "q\_1",  
        "order\_index": 1,  
        "question\_text": "Укажите правильный вариант...",  
        "question\_type": "single\_choice",  
        "options": {  
          "A": "вариант А",  
          "B": "вариант Б",  
          "C": "вариант В",  
          "D": "вариант Г"  
        },  
        "topic": "Орфография"  
      }  
    \]  
  }  
}

## **Правила**

1. Проверить доступ.  
2. Найти активный Access.  
3. Если несколько активных Access, выбрать тот, у которого раньше expires\_at.  
4. Создать Attempt.  
5. Создать snapshot теста.  
6. Уменьшить attempts\_available на 1\.  
7. Не отдавать correct\_answer.  
8. Операция должна быть transaction.

---

# **11.3. Получить текущую попытку**

GET /api/attempts/:attempt\_id

## **Response**

{  
  "success": true,  
  "data": {  
    "attempt\_id": "uuid",  
    "status": "started",  
    "started\_at": "2026-06-28T12:00:00Z",  
    "duration\_minutes": 60,  
    "server\_now": "2026-06-28T12:15:00Z",  
    "answers": \[  
      {  
        "snapshot\_question\_id": "q\_1",  
        "selected\_answer": "B"  
      }  
    \],  
    "questions": \[\]  
  }  
}

## **Правила**

1. Если попытка started, не отдавать правильные ответы.  
2. Если попытка completed/expired, можно перенаправить на result endpoint.  
3. Проверить, что ученик имеет право видеть попытку.

---

# **11.4. Сохранить ответ**

POST /api/attempts/:attempt\_id/answers

## **Request для single\_choice**

{  
  "snapshot\_question\_id": "q\_1",  
  "selected\_answer": "B"  
}

## **Request для multiple\_choice**

{  
  "snapshot\_question\_id": "q\_2",  
  "selected\_answer": "A,C"  
}

## **Request для short\_text**

{  
  "snapshot\_question\_id": "q\_3",  
  "selected\_answer": "пришёл"  
}

## **Response**

{  
  "success": true,  
  "data": {  
    "saved": true  
  }  
}

## **Правила**

1. Attempt должен быть started.  
2. Если attempt завершён, вернуть ошибку.  
3. Ответ можно перезаписывать до завершения.  
4. Не считать correctness на frontend.  
5. Можно делать upsert по attempt\_id \+ snapshot\_question\_id.

---

# **11.5. Завершить попытку**

POST /api/attempts/:attempt\_id/complete

## **Response**

{  
  "success": true,  
  "data": {  
    "attempt\_id": "uuid",  
    "result\_url": "/results/uuid"  
  }  
}

## **Правила**

1. Attempt должен быть started.  
2. Ответы после завершения заблокировать.  
3. Посчитать результат на backend.  
4. Заполнить:

   * raw\_score;  
   * max\_raw\_score;  
   * percent;  
   * level;  
   * topic\_results\_json;  
   * recommendations\_json;  
   * scaled\_score, если есть шкала.  
5. Status \= completed.  
6. finished\_at \= now.  
7. Можно отправить email с результатом, если включено.

---

# **11.6. Автозавершение по таймеру**

POST /api/attempts/:attempt\_id/expire

## **Response**

{  
  "success": true,  
  "data": {  
    "attempt\_id": "uuid",  
    "status": "expired",  
    "result\_url": "/results/uuid"  
  }  
}

## **Правила**

1. Backend должен проверить, что время действительно вышло.  
2. Нельзя доверять только frontend-таймеру.  
3. Если время не вышло, вернуть ошибку.  
4. Если время вышло, завершить попытку.  
5. Пустые ответы считать неправильными.  
6. Result считается так же, как при обычном завершении.

---

# **12\. Result API**

---

# **12.1. Получить результат попытки**

GET /api/results/:attempt\_id

## **Response**

{  
  "success": true,  
  "data": {  
    "attempt\_id": "uuid",  
    "test\_title": "Русский язык. Тренировочный тест №1",  
    "status": "completed",  
    "raw\_score": 27,  
    "max\_raw\_score": 40,  
    "percent": 67.5,  
    "level": "средний",  
    "scaled\_score": null,  
    "topic\_results": \[  
      {  
        "topic": "Орфография",  
        "score": 6,  
        "max\_score": 10,  
        "percent": 60,  
        "status": "requires\_review"  
      }  
    \],  
    "recommendations": \[  
      {  
        "topic": "Пунктуация",  
        "subtopics": \["деепричастный оборот"\],  
        "message": "Повторите пунктуацию в конструкциях с деепричастным оборотом."  
      }  
    \],  
    "mistakes": \[  
      {  
        "snapshot\_question\_id": "q\_5",  
        "question\_text": "Укажите правильный вариант...",  
        "question\_type": "single\_choice",  
        "selected\_answer": "A",  
        "correct\_answer": "B",  
        "topic": "Орфография",  
        "subtopic": "Н/НН",  
        "points\_earned": 0,  
        "max\_points": 1,  
        "explanation": null  
      }  
    \]  
  }  
}

## **Правила**

1. Результат доступен только после completed/expired.  
2. Ученик может видеть только свой результат.  
3. Админ может видеть все результаты.  
4. Здесь уже можно отдавать correct\_answer.

---

# **13\. Admin Auth API**

---

# **13.1. Login**

POST /api/admin/auth/login

## **Request**

{  
  "email": "admin@example.com",  
  "password": "password"  
}

## **Response**

{  
  "success": true,  
  "data": {  
    "user": {  
      "id": "uuid",  
      "email": "admin@example.com",  
      "role": "admin"  
    }  
  }  
}

## **Правила**

1. Проверить email/password.  
2. Проверить role \= admin.  
3. Создать session/cookie/token.  
4. Пароль сравнивать с hash.

---

# **13.2. Logout**

POST /api/admin/auth/logout  
---

# **13.3. Me**

GET /api/admin/auth/me  
---

# **14\. Admin Tests API**

---

# **14.1. Список тестов**

GET /api/admin/tests

## **Query params**

status optional  
subject optional  
mode optional  
search optional  
page optional  
limit optional

## **Response**

{  
  "success": true,  
  "data": {  
    "items": \[  
      {  
        "id": "uuid",  
        "title": "Русский язык. Тест №1",  
        "slug": "russian-test-1",  
        "subject": "russian",  
        "mode": "training",  
        "status": "draft",  
        "questions\_count": 40,  
        "max\_raw\_score": 40,  
        "price": 1500,  
        "currency": "BYN",  
        "updated\_at": "2026-06-28T12:00:00Z"  
      }  
    \],  
    "pagination": {}  
  }  
}  
---

# **14.2. Создать тест**

POST /api/admin/tests

## **Request**

{  
  "title": "Русский язык. Тренировочный тест №1",  
  "subject": "russian",  
  "mode": "training",  
  "short\_description": "Краткое описание",  
  "full\_description": "Полное описание",  
  "price": 1500,  
  "currency": "BYN",  
  "duration\_minutes": 60,  
  "attempts\_limit": 1,  
  "access\_days": 7  
}

## **Response**

{  
  "success": true,  
  "data": {  
    "id": "uuid",  
    "slug": "russian-test-1",  
    "status": "draft"  
  }  
}  
---

# **14.3. Получить тест**

GET /api/admin/tests/:test\_id  
---

# **14.4. Обновить тест**

PATCH /api/admin/tests/:test\_id

## **Request**

{  
  "title": "Новое название",  
  "short\_description": "Новое описание",  
  "price": 2000,  
  "duration\_minutes": 70,  
  "attempts\_limit": 1,  
  "access\_days": 7  
}  
---

# **14.5. Удалить тест**

DELETE /api/admin/tests/:test\_id

## **Правила**

1. Лучше soft delete.  
2. Если у теста есть попытки/оплаты, физически удалять нельзя.  
3. После удаления тест не виден публично.

---

# **14.6. Опубликовать тест**

POST /api/admin/tests/:test\_id/publish

## **Response**

{  
  "success": true,  
  "data": {  
    "status": "published",  
    "published\_at": "2026-06-28T12:00:00Z"  
  }  
}

## **Правила**

Перед публикацией проверить:

1. название;  
2. цену;  
3. время;  
4. срок доступа;  
5. наличие вопросов;  
6. correct\_answer;  
7. topic;  
8. points;  
9. scoring scheme, если включена шкала.

---

# **14.7. Скрыть тест**

POST /api/admin/tests/:test\_id/hide  
---

# **14.8. Проверить готовность к публикации**

GET /api/admin/tests/:test\_id/publish-check

## **Response**

{  
  "success": true,  
  "data": {  
    "can\_publish": false,  
    "errors": \[  
      {  
        "code": "NO\_QUESTIONS",  
        "message": "В тесте нет вопросов"  
      }  
    \],  
    "warnings": \[  
      {  
        "code": "NO\_EXPLANATIONS",  
        "message": "У части вопросов нет объяснений"  
      }  
    \]  
  }  
}  
---

# **15\. Admin Questions API**

---

# **15.1. Список вопросов теста**

GET /api/admin/tests/:test\_id/questions  
---

# **15.2. Создать вопрос**

POST /api/admin/tests/:test\_id/questions

## **Request для single\_choice**

{  
  "question\_text": "Укажите правильный вариант...",  
  "question\_type": "single\_choice",  
  "option\_a": "вариант А",  
  "option\_b": "вариант Б",  
  "option\_c": "вариант В",  
  "option\_d": "вариант Г",  
  "correct\_answer": "B",  
  "topic": "Орфография",  
  "subtopic": "Н/НН",  
  "difficulty": "medium",  
  "points": 1,  
  "explanation": null,  
  "source": null  
}

## **Request для multiple\_choice**

{  
  "question\_text": "Выберите все правильные варианты...",  
  "question\_type": "multiple\_choice",  
  "option\_a": "вариант А",  
  "option\_b": "вариант Б",  
  "option\_c": "вариант В",  
  "option\_d": "вариант Г",  
  "correct\_answer": "A,C",  
  "topic": "Пунктуация",  
  "points": 2  
}

## **Request для short\_text**

{  
  "question\_text": "Введите правильную форму слова",  
  "question\_type": "short\_text",  
  "correct\_answer": "пришёл;пришел",  
  "topic": "Орфография",  
  "subtopic": "Е/Ё",  
  "points": 1  
}  
---

# **15.3. Обновить вопрос**

PATCH /api/admin/questions/:question\_id  
---

# **15.4. Удалить вопрос**

DELETE /api/admin/questions/:question\_id  
---

# **15.5. Изменить порядок вопроса**

PATCH /api/admin/questions/:question\_id/order

## **Request**

{  
  "direction": "up"  
}

или

{  
  "direction": "down"  
}  
---

# **16\. Admin Import API**

---

# **16.1. Скачать шаблон**

GET /api/admin/import/template

## **Query params**

format=xlsx

или

format=csv  
---

# **16.2. Валидировать файл**

POST /api/admin/tests/:test\_id/import/validate

## **Request**

Multipart form-data:

file  
mode \= append | replace

## **Response**

{  
  "success": true,  
  "data": {  
    "import\_job\_id": "uuid",  
    "status": "validated",  
    "total\_rows": 40,  
    "valid\_rows": 38,  
    "error\_rows": 0,  
    "warning\_rows": 2,  
    "errors": \[\],  
    "warnings": \[  
      {  
        "row": 12,  
        "field": "explanation",  
        "message": "Объяснение не заполнено"  
      }  
    \],  
    "preview": \[\]  
  }  
}  
---

# **16.3. Подтвердить импорт**

POST /api/admin/import/:import\_job\_id/commit

## **Response**

{  
  "success": true,  
  "data": {  
    "imported\_questions": 40,  
    "mode": "append"  
  }  
}

## **Правила**

1. Нельзя commit, если есть критические ошибки.  
2. При append добавить вопросы.  
3. При replace заменить текущие вопросы.  
4. После commit пересчитать questions\_count и max\_raw\_score.

---

# **16.4. Получить ошибки импорта**

GET /api/admin/import/:import\_job\_id/errors  
---

# **17\. Admin Payments API**

---

# **17.1. Список оплат**

GET /api/admin/payments

## **Query params**

status optional  
test\_id optional  
email optional  
date\_from optional  
date\_to optional  
page optional  
limit optional  
---

# **17.2. Детали оплаты**

GET /api/admin/payments/:payment\_id  
---

# **18\. Admin Accesses API**

---

# **18.1. Список доступов**

GET /api/admin/accesses

## **Query params**

test\_id optional  
email optional  
source optional  
status optional  
page optional  
limit optional  
---

# **18.2. Ручная выдача доступа**

POST /api/admin/accesses/manual

## **Request**

{  
  "email": "student@example.com",  
  "name": "Иван",  
  "test\_id": "uuid",  
  "attempts\_total": 1,  
  "access\_days": 7,  
  "comment": "Оплатил наличными"  
}

## **Response**

{  
  "success": true,  
  "data": {  
    "access\_id": "uuid",  
    "expires\_at": "2026-07-05T12:00:00Z"  
  }  
}

## **Правила**

1. Найти или создать student user.  
2. Создать Access source \= manual.  
3. Создать ManualAccessLog.  
4. Отправить email.

---

# **18.3. Повторно отправить ссылку доступа**

POST /api/admin/accesses/:access\_id/resend-link

Желательно в MVP, но можно P1.

---

# **18.4. Отозвать доступ**

POST /api/admin/accesses/:access\_id/revoke

Можно P1, но поля в базе заложить сразу.

## **Request**

{  
  "reason": "Ошибочная выдача"  
}  
---

# **19\. Admin Access Codes API**

---

# **19.1. Список кодов**

GET /api/admin/access-codes

## **Query params**

test\_id optional  
status optional  
page optional  
limit optional  
---

# **19.2. Создать код**

POST /api/admin/access-codes

## **Request**

{  
  "test\_id": "uuid",  
  "attempts\_total": 1,  
  "access\_days": 7,  
  "code\_expires\_at": "2026-07-05T12:00:00Z",  
  "comment": "Оплата наличными"  
}

## **Response**

{  
  "success": true,  
  "data": {  
    "access\_code\_id": "uuid",  
    "code": "RUS-8F3K-21QZ",  
    "status": "active",  
    "code\_expires\_at": "2026-07-05T12:00:00Z"  
  }  
}

## **Правила**

1. Сгенерировать случайный код.  
2. В базе сохранить hash.  
3. Сам код вернуть только один раз после создания.  
4. Привязать код к test\_id.  
5. Status \= active.

---

# **19.3. Отозвать код**

POST /api/admin/access-codes/:access\_code\_id/revoke

## **Request**

{  
  "reason": "Код выдан ошибочно"  
}

## **Правила**

1. Нельзя отозвать used код.  
2. Можно отозвать active код.  
3. status \= revoked.

---

# **20\. Admin Results API**

---

# **20.1. Список попыток**

GET /api/admin/attempts

## **Query params**

test\_id optional  
email optional  
status optional  
date\_from optional  
date\_to optional  
page optional  
limit optional  
---

# **20.2. Детали попытки**

GET /api/admin/attempts/:attempt\_id

## **Response**

{  
  "success": true,  
  "data": {  
    "attempt\_id": "uuid",  
    "student": {  
      "email": "student@example.com",  
      "name": "Иван"  
    },  
    "test": {  
      "id": "uuid",  
      "title": "Русский язык. Тест №1"  
    },  
    "status": "completed",  
    "raw\_score": 27,  
    "max\_raw\_score": 40,  
    "percent": 67.5,  
    "level": "средний",  
    "topic\_results": \[\],  
    "answers": \[\]  
  }  
}  
---

# **20.3. Экспорт результатов**

GET /api/admin/attempts/export

Формат:

CSV.

Можно вынести в P1, если сроки ограничены.

---

# **21\. Admin Scoring API**

Нужно заложить архитектурно. Реализация зависит от того, входит ли шкала ЦЭ/ЦТ в MVP.

---

# **21.1. Список шкал**

GET /api/admin/scoring-schemes  
---

# **21.2. Создать шкалу**

POST /api/admin/scoring-schemes

## **Request**

{  
  "name": "Русский язык ЦТ 2026",  
  "subject": "russian",  
  "exam\_type": "ct",  
  "year": 2026,  
  "max\_raw\_score": 40,  
  "max\_scaled\_score": 100  
}  
---

# **21.3. Импортировать таблицу шкалы**

POST /api/admin/scoring-schemes/:scheme\_id/import-scale

Файл должен содержать:

raw\_score  
scaled\_score  
---

# **21.4. Привязать шкалу к тесту**

PATCH /api/admin/tests/:test\_id/scoring

## **Request**

{  
  "mode": "ce\_ct",  
  "scoring\_scheme\_id": "uuid",  
  "show\_scaled\_score": true  
}  
---

# **22\. Правила расчёта ответов**

---

## **22.1. single\_choice**

is\_correct \= selected\_answer \== correct\_answer

Если правильно:

points\_earned \= max\_points

Если неправильно:

points\_earned \= 0  
---

## **22.2. multiple\_choice**

Нормализация:

1. split по запятой;  
2. trim;  
3. uppercase;  
4. sort;  
5. compare.

Пример:

selected\_answer \= C,A  
correct\_answer \= A,C

После нормализации оба значения равны:

A,C

Если полное совпадение:

points\_earned \= max\_points

Иначе:

points\_earned \= 0

Частичные баллы в MVP не начисляются.

---

## **22.3. short\_text**

Нормализация:

1. trim;  
2. lowercase;  
3. заменить множественные пробелы на один;  
4. сравнить с допустимыми ответами.

Пример:

correct\_answer \= пришёл;пришел  
selected\_answer \= Пришёл

После нормализации:

пришёл

Ответ правильный.

В MVP не делать:

1. fuzzy matching;  
2. AI-проверку;  
3. морфологическую проверку;  
4. ручную проверку.

---

# **23\. Транзакции**

Критические операции должны выполняться в transaction.

## **Обязательно transaction**

1. успешный webhook оплаты:

   * обновить Payment;  
   * создать Access;  
   * создать EventLog;  
2. активация кода:

   * проверить код;  
   * создать/найти User;  
   * создать Access;  
   * пометить код used;  
3. старт попытки:

   * проверить Access;  
   * создать Attempt;  
   * создать snapshot;  
   * уменьшить attempts\_available;  
4. commit импорта:

   * создать вопросы;  
   * обновить счётчики теста;  
   * обновить ImportJob;  
5. завершение попытки:

   * проверить ответы;  
   * посчитать результат;  
   * обновить Answers;  
   * обновить Attempt.

---

# **24\. Acceptance criteria для backend/API**

Backend/API считается готовым, если:

1. можно создать тест;  
2. можно добавить вопросы трёх типов;  
3. можно импортировать Excel/CSV;  
4. импорт не проходит с критическими ошибками;  
5. можно опубликовать валидный тест;  
6. ученик видит опубликованный тест;  
7. ученик может оплатить тест;  
8. успешный webhook создаёт Access;  
9. повторный webhook не создаёт второй Access;  
10. админ может вручную выдать Access;  
11. админ может создать одноразовый код;  
12. ученик может активировать одноразовый код;  
13. один код нельзя активировать дважды;  
14. ученик не может начать тест без Access;  
15. при старте списывается попытка;  
16. при старте создаётся snapshot;  
17. правильные ответы не отдаются до завершения;  
18. ответы сохраняются;  
19. попытка завершается вручную;  
20. попытка завершается по таймеру;  
21. результат считается на backend;  
22. результат по темам считается корректно;  
23. ученик видит результат после завершения;  
24. админ видит оплаты, доступы, коды и результаты;  
25. старые результаты не ломаются после редактирования теста.

---

# **25\. Приоритеты реализации API**

## **P0**

1. users;  
2. tests;  
3. questions;  
4. public tests;  
5. admin auth;  
6. admin tests;  
7. admin questions;  
8. import;  
9. payments;  
10. payment webhook;  
11. accesses;  
12. manual access;  
13. access codes;  
14. attempts;  
15. answers;  
16. result calculation;  
17. admin results.

## **P0.5**

1. scoring schemes;  
2. scoring scales;  
3. CE/CT 0-100;  
4. resend access link;  
5. export results.

## **P1**

1. revoke access;  
2. revoke code;  
3. advanced filters;  
4. dashboard metrics;  
5. CSV exports;  
6. detailed email logs UI.

---

# **26\. Итог**

Для MVP v1.1 нужна база и API, которые поддерживают полную цепочку:

админ создаёт тест → добавляет вопросы вручную или через Excel/CSV → публикует тест → ученик получает доступ через оплату, ручную выдачу или одноразовый код → проходит тест → backend считает результат → ученик видит ошибки и правильные ответы → админ видит оплаты, доступы, коды и результаты.

Ключевые технические обязательства:

1. snapshot теста при старте попытки;  
2. правильные ответы не отдавать до завершения;  
3. результат считать только на backend;  
4. одноразовые коды хранить через hash;  
5. webhook оплаты делать идемпотентным;  
6. старые результаты не пересчитывать после правок теста;  
7. архитектурно заложить CE/CT scoring, даже если шкала 0-100 будет подключена позже.

