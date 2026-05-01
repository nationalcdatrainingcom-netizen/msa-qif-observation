-- ════════════════════════════════════════════════════════════════════
-- MSA Platform — Reflection Question Seed Data
-- ════════════════════════════════════════════════════════════════════
-- Loads the question structure for all three reflection types across
-- all 12 weeks plus the 3 end-of-domain reflections.
--
-- ─ DATA MODEL ──────────────────────────────────────────────────────
-- Questions are stored in a `reflection_questions` table (created
-- below) so they can be edited without code changes. The reflections
-- UI fetches them at page load.
--
-- Each row defines a question for a specific:
--   • reflection_type: 'weekly' | 'daily' | 'end_of_domain'
--   • role:            'mentor' | 'mentee'
--   • week_number:     1–12 (NULL for end_of_domain)
--   • domain_number:   1–3 (only for end_of_domain)
--   • section:         display heading within the form
--   • question_order:  display order within section
--
-- Question IDs use a stable string format so saved responses don't
-- break if questions are added/reordered later:
--   <type>-<role>-w<week>-<section>-q<n>     for weekly/daily
--   <type>-<role>-d<domain>-<section>-q<n>   for end_of_domain
--
-- ─ AUTHORSHIP NOTE ─────────────────────────────────────────────────
-- Weeks 1 and 2 use Rebecca's exact wording from the Inspired Growth
-- 12-Week Reflection Guide. Weeks 3-12 use the same structural pattern
-- with topic-appropriate questions written to fit the curriculum.
-- These can be edited directly in this table when Rebecca finalizes
-- her wording — no code changes needed.
-- ════════════════════════════════════════════════════════════════════

BEGIN;

-- ────────────────────────────────────────────────────────────────────
-- TABLE
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS reflection_questions (
  id SERIAL PRIMARY KEY,
  question_id TEXT UNIQUE NOT NULL,
  reflection_type TEXT NOT NULL CHECK (reflection_type IN ('weekly','daily','end_of_domain')),
  role TEXT NOT NULL CHECK (role IN ('mentor','mentee')),
  week_number INTEGER,
  domain_number INTEGER,
  topic TEXT,
  section TEXT NOT NULL,
  question_order INTEGER NOT NULL,
  question_text TEXT NOT NULL,
  scale_type TEXT DEFAULT 'text' CHECK (scale_type IN ('text','rating_5','short_text')),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rq_lookup
  ON reflection_questions(reflection_type, role, week_number, domain_number);

-- Wipe existing seed (lets you re-run this script after edits)
TRUNCATE TABLE reflection_questions RESTART IDENTITY;

-- ════════════════════════════════════════════════════════════════════
-- WEEKLY REFLECTIONS — MENTEE
-- ════════════════════════════════════════════════════════════════════
-- Per Rebecca's guide, the Weekly Reflection is completed by the
-- mentee. Mentor's role on the weekly cadence is "Mentor Session Notes"
-- captured during their meeting — handled via Daily reflections + the
-- end-of-domain reflection.

-- ─── WEEK 1: Positive Climate ───────────────────────────────────────
INSERT INTO reflection_questions (question_id, reflection_type, role, week_number, topic, section, question_order, question_text) VALUES
('weekly-mentee-w1-recap-q1','weekly','mentee',1,'Positive Climate','Previous Week Recap',1,
 'This is your first week — take a moment to describe what brought you to this mentoring journey. What are you hoping to walk away with by the end of Week 12?'),
('weekly-mentee-w1-recap-q2','weekly','mentee',1,'Positive Climate','Previous Week Recap',2,
 'What is one area of your teaching you feel proud of right now, and one area you are genuinely curious about improving?'),
('weekly-mentee-w1-strategies-q1','weekly','mentee',1,'Positive Climate','Strategies Used & Outcomes',1,
 'Describe a specific moment this week when you felt genuine warmth and connection with a child or group of children. What did that look like? What made it possible?'),
('weekly-mentee-w1-strategies-q2','weekly','mentee',1,'Positive Climate','Strategies Used & Outcomes',2,
 'What intentional strategies did you try to create or sustain a positive emotional climate in your classroom this week? What was the outcome?'),
('weekly-mentee-w1-strategies-q3','weekly','mentee',1,'Positive Climate','Strategies Used & Outcomes',3,
 'Was there a moment when the emotional tone in your classroom shifted — positively or negatively? What do you think caused that shift?'),
('weekly-mentee-w1-goals-q1','weekly','mentee',1,'Positive Climate','Goals for the Week Ahead',1,
 'Based on what you explored this week around Positive Climate, identify one specific, observable goal for your classroom environment next week.'),
('weekly-mentee-w1-goals-q2','weekly','mentee',1,'Positive Climate','Goals for the Week Ahead',2,
 'What is one thing you want to be more intentional about when greeting or connecting with children in the days ahead?');

INSERT INTO reflection_questions (question_id, reflection_type, role, week_number, topic, section, question_order, question_text, scale_type) VALUES
('weekly-mentee-w1-data-q1','weekly','mentee',1,'Positive Climate','Data, Assessment & Progress',1,
 'On a scale of 1–5, how would you rate the overall positive climate in your classroom this week? What evidence supports your rating?','rating_5');

INSERT INTO reflection_questions (question_id, reflection_type, role, week_number, topic, section, question_order, question_text) VALUES
('weekly-mentee-w1-data-q2','weekly','mentee',1,'Positive Climate','Data, Assessment & Progress',2,
 'Did you observe any children who seemed disconnected or disengaged from the emotional tone of the room? What might that be telling you?');

-- ─── WEEK 2: Teacher Sensitivity ────────────────────────────────────
INSERT INTO reflection_questions (question_id, reflection_type, role, week_number, topic, section, question_order, question_text) VALUES
('weekly-mentee-w2-recap-q1','weekly','mentee',2,'Teacher Sensitivity','Previous Week Recap',1,
 'Last week you focused on Positive Climate. Looking back, what was your biggest takeaway about the emotional tone in your classroom?'),
('weekly-mentee-w2-recap-q2','weekly','mentee',2,'Teacher Sensitivity','Previous Week Recap',2,
 'Did you follow through on your goal from Week 1? What happened — and if you didn''t fully meet it, what got in the way?'),
('weekly-mentee-w2-strategies-q1','weekly','mentee',2,'Teacher Sensitivity','Strategies Used & Outcomes',1,
 'Describe a moment this week when you noticed a child''s unspoken need — academic, emotional, or social — and were able to respond to it. What cues did you pick up on?'),
('weekly-mentee-w2-strategies-q2','weekly','mentee',2,'Teacher Sensitivity','Strategies Used & Outcomes',2,
 'What is one situation where you feel like your sensitivity response was effective? What made it work?'),
('weekly-mentee-w2-strategies-q3','weekly','mentee',2,'Teacher Sensitivity','Strategies Used & Outcomes',3,
 'Were there moments this week where you noticed a need but were unable to respond the way you would have liked? What got in the way?'),
('weekly-mentee-w2-goals-q1','weekly','mentee',2,'Teacher Sensitivity','Goals for the Week Ahead',1,
 'Identify one specific child in your classroom whose emotional or academic needs you want to be more attentive to next week. What will you watch for?'),
('weekly-mentee-w2-goals-q2','weekly','mentee',2,'Teacher Sensitivity','Goals for the Week Ahead',2,
 'What one small practice will you add or strengthen this week to increase your attunement with your children?'),
('weekly-mentee-w2-data-q1','weekly','mentee',2,'Teacher Sensitivity','Data, Assessment & Progress',1,
 'How would you describe your current level of observational awareness in the classroom — what are you getting better at noticing?'),
('weekly-mentee-w2-data-q2','weekly','mentee',2,'Teacher Sensitivity','Data, Assessment & Progress',2,
 'What patterns are you beginning to see in how children signal their needs, and how are you tracking or remembering those signals?');

-- ─── WEEK 3: Regard for Child Perspective ───────────────────────────
INSERT INTO reflection_questions (question_id, reflection_type, role, week_number, topic, section, question_order, question_text) VALUES
('weekly-mentee-w3-recap-q1','weekly','mentee',3,'Regard for Child Perspective','Previous Week Recap',1,
 'Last week you focused on Teacher Sensitivity. What is one moment where you noticed a child''s need and responded well? What made that possible?'),
('weekly-mentee-w3-recap-q2','weekly','mentee',3,'Regard for Child Perspective','Previous Week Recap',2,
 'Did your goal around attunement come to life this week? Where did you see growth, and where do you still want to stretch?'),
('weekly-mentee-w3-strategies-q1','weekly','mentee',3,'Regard for Child Perspective','Strategies Used & Outcomes',1,
 'Describe a moment this week when you gave children real choice or autonomy in an activity. How did they respond?'),
('weekly-mentee-w3-strategies-q2','weekly','mentee',3,'Regard for Child Perspective','Strategies Used & Outcomes',2,
 'When did you let a child''s idea, interest, or pace shape what was happening in the room — even if it changed your plan?'),
('weekly-mentee-w3-strategies-q3','weekly','mentee',3,'Regard for Child Perspective','Strategies Used & Outcomes',3,
 'Where did you catch yourself wanting to control the moment? What did you do — and what might you try next time?'),
('weekly-mentee-w3-goals-q1','weekly','mentee',3,'Regard for Child Perspective','Goals for the Week Ahead',1,
 'Identify one routine or transition where you want to give children more voice or choice next week. What will that look like?'),
('weekly-mentee-w3-goals-q2','weekly','mentee',3,'Regard for Child Perspective','Goals for the Week Ahead',2,
 'What is one phrase or question you want to use more often to invite children''s thinking?'),
('weekly-mentee-w3-data-q1','weekly','mentee',3,'Regard for Child Perspective','Data, Assessment & Progress',1,
 'How are you balancing structure with flexibility in your classroom? Which children seem to thrive most when given autonomy?'),
('weekly-mentee-w3-data-q2','weekly','mentee',3,'Regard for Child Perspective','Data, Assessment & Progress',2,
 'What surprised you this week about how children responded to having more agency?');

-- ─── WEEK 4: Negative Climate (Absence of) ──────────────────────────
INSERT INTO reflection_questions (question_id, reflection_type, role, week_number, topic, section, question_order, question_text) VALUES
('weekly-mentee-w4-recap-q1','weekly','mentee',4,'Negative Climate (Absence of)','Previous Week Recap',1,
 'Looking back at Weeks 1–3, what is one shift in the emotional climate of your classroom you can clearly see now?'),
('weekly-mentee-w4-recap-q2','weekly','mentee',4,'Negative Climate (Absence of)','Previous Week Recap',2,
 'How are you doing as a learner in this process? What is feeling sustainable, and what is feeling heavy?'),
('weekly-mentee-w4-strategies-q1','weekly','mentee',4,'Negative Climate (Absence of)','Strategies Used & Outcomes',1,
 'This week the focus is the absence of negativity — sarcasm, harsh tone, frustration. Describe a moment you caught yourself before reacting in a way you would have regretted. What helped?'),
('weekly-mentee-w4-strategies-q2','weekly','mentee',4,'Negative Climate (Absence of)','Strategies Used & Outcomes',2,
 'When did you feel your patience or composure tested this week? What did the children see in you in that moment?'),
('weekly-mentee-w4-strategies-q3','weekly','mentee',4,'Negative Climate (Absence of)','Strategies Used & Outcomes',3,
 'How did you take care of yourself this week so you could show up as the teacher your children need?'),
('weekly-mentee-w4-goals-q1','weekly','mentee',4,'Negative Climate (Absence of)','Goals for the Week Ahead',1,
 'What is one personal practice (a breath, a phrase, a reset) you want to use more consistently in the moments before you respond to children?'),
('weekly-mentee-w4-goals-q2','weekly','mentee',4,'Negative Climate (Absence of)','Goals for the Week Ahead',2,
 'As you close Domain 1, what is one piece of your emotional climate work you want to keep practicing into Domain 2?'),
('weekly-mentee-w4-data-q1','weekly','mentee',4,'Negative Climate (Absence of)','Data, Assessment & Progress',1,
 'Across these four weeks, how would you describe the change (if any) in how children behave during your most demanding moments — drop-off, transitions, end of day?'),
('weekly-mentee-w4-data-q2','weekly','mentee',4,'Negative Climate (Absence of)','Data, Assessment & Progress',2,
 'What patterns do you notice about your own triggers? Time of day? Specific situations? Specific children?');

-- ─── WEEK 5: Behavior Management ────────────────────────────────────
INSERT INTO reflection_questions (question_id, reflection_type, role, week_number, topic, section, question_order, question_text) VALUES
('weekly-mentee-w5-recap-q1','weekly','mentee',5,'Behavior Management','Previous Week Recap',1,
 'You just finished Domain 1: Emotional Climate & Responsiveness. As you step into Domain 2, what is one thing you are bringing forward with you?'),
('weekly-mentee-w5-recap-q2','weekly','mentee',5,'Behavior Management','Previous Week Recap',2,
 'How do you think the work you did on emotional climate will affect the way you approach behavior management this week?'),
('weekly-mentee-w5-strategies-q1','weekly','mentee',5,'Behavior Management','Strategies Used & Outcomes',1,
 'Describe a behavior moment this week where you were proactive rather than reactive. What did you do, and what made it work?'),
('weekly-mentee-w5-strategies-q2','weekly','mentee',5,'Behavior Management','Strategies Used & Outcomes',2,
 'What classroom expectations or routines feel clearest to your children right now? Where is there confusion?'),
('weekly-mentee-w5-strategies-q3','weekly','mentee',5,'Behavior Management','Strategies Used & Outcomes',3,
 'Was there a behavior moment this week that didn''t go the way you wanted? What would you do differently if it happened tomorrow?'),
('weekly-mentee-w5-goals-q1','weekly','mentee',5,'Behavior Management','Goals for the Week Ahead',1,
 'Identify one specific routine or transition where behavior tends to fall apart. What is one change you want to test next week?'),
('weekly-mentee-w5-goals-q2','weekly','mentee',5,'Behavior Management','Goals for the Week Ahead',2,
 'What is one positive-behavior strategy (catching the right thing, narrating expectations) you want to use more often?'),
('weekly-mentee-w5-data-q1','weekly','mentee',5,'Behavior Management','Data, Assessment & Progress',1,
 'When are the high-behavior moments in your day? What patterns can you name?'),
('weekly-mentee-w5-data-q2','weekly','mentee',5,'Behavior Management','Data, Assessment & Progress',2,
 'What proportion of your behavior energy is going toward redirection vs. recognition right now? What feels right for your group?');

-- ─── WEEK 6: Productivity ───────────────────────────────────────────
INSERT INTO reflection_questions (question_id, reflection_type, role, week_number, topic, section, question_order, question_text) VALUES
('weekly-mentee-w6-recap-q1','weekly','mentee',6,'Productivity','Previous Week Recap',1,
 'Last week you worked on behavior management. What changed (even slightly) when you tried being more proactive?'),
('weekly-mentee-w6-recap-q2','weekly','mentee',6,'Productivity','Previous Week Recap',2,
 'Did the routine or transition you targeted improve? What surprised you about how children responded?'),
('weekly-mentee-w6-strategies-q1','weekly','mentee',6,'Productivity','Strategies Used & Outcomes',1,
 'Describe a transition or activity this week that flowed beautifully. What did you set up that made it work?'),
('weekly-mentee-w6-strategies-q2','weekly','mentee',6,'Productivity','Strategies Used & Outcomes',2,
 'Where in your day are children spending too much time waiting, lining up, or being managed instead of learning?'),
('weekly-mentee-w6-strategies-q3','weekly','mentee',6,'Productivity','Strategies Used & Outcomes',3,
 'What is one thing you did this week to maximize learning time? What is one thing that ate it up?'),
('weekly-mentee-w6-goals-q1','weekly','mentee',6,'Productivity','Goals for the Week Ahead',1,
 'Identify one transition you want to streamline next week. What will you change?'),
('weekly-mentee-w6-goals-q2','weekly','mentee',6,'Productivity','Goals for the Week Ahead',2,
 'What is one preparation habit you want to build so the day flows more smoothly for you and the children?'),
('weekly-mentee-w6-data-q1','weekly','mentee',6,'Productivity','Data, Assessment & Progress',1,
 'How much of your day right now is active learning vs. transition / waiting / management? Make a rough estimate.'),
('weekly-mentee-w6-data-q2','weekly','mentee',6,'Productivity','Data, Assessment & Progress',2,
 'What does the energy of your room feel like during your most productive stretches? What can you replicate?');

-- ─── WEEK 7: Instructional Learning Formats ─────────────────────────
INSERT INTO reflection_questions (question_id, reflection_type, role, week_number, topic, section, question_order, question_text) VALUES
('weekly-mentee-w7-recap-q1','weekly','mentee',7,'Instructional Learning Formats','Previous Week Recap',1,
 'You worked on productivity last week. Where in the day did you reclaim time for real learning?'),
('weekly-mentee-w7-recap-q2','weekly','mentee',7,'Instructional Learning Formats','Previous Week Recap',2,
 'How has your sense of what your day "should" look like changed since Week 1?'),
('weekly-mentee-w7-strategies-q1','weekly','mentee',7,'Instructional Learning Formats','Strategies Used & Outcomes',1,
 'Describe an activity this week that pulled in even your hardest-to-engage children. What did the format have that worked?'),
('weekly-mentee-w7-strategies-q2','weekly','mentee',7,'Instructional Learning Formats','Strategies Used & Outcomes',2,
 'What variety did you offer this week — hands-on, discussion, movement, story? Which formats are doing the heaviest lifting in your room right now?'),
('weekly-mentee-w7-strategies-q3','weekly','mentee',7,'Instructional Learning Formats','Strategies Used & Outcomes',3,
 'Which children are clearly engaged most days, and which are only pulled in by specific formats? What does that tell you?'),
('weekly-mentee-w7-goals-q1','weekly','mentee',7,'Instructional Learning Formats','Goals for the Week Ahead',1,
 'Identify one learning format you want to use more next week. Why?'),
('weekly-mentee-w7-goals-q2','weekly','mentee',7,'Instructional Learning Formats','Goals for the Week Ahead',2,
 'What is one child you want to specifically try to engage through a different format next week?'),
('weekly-mentee-w7-data-q1','weekly','mentee',7,'Instructional Learning Formats','Data, Assessment & Progress',1,
 'How are you measuring engagement right now — eyes, hands, talk, follow-through? What''s working?'),
('weekly-mentee-w7-data-q2','weekly','mentee',7,'Instructional Learning Formats','Data, Assessment & Progress',2,
 'What patterns do you see between certain formats and certain learners?');

-- ─── WEEK 8: Learning Environment Design ────────────────────────────
INSERT INTO reflection_questions (question_id, reflection_type, role, week_number, topic, section, question_order, question_text) VALUES
('weekly-mentee-w8-recap-q1','weekly','mentee',8,'Learning Environment Design','Previous Week Recap',1,
 'Looking back at Domain 2 so far — behavior, productivity, formats — what is the through-line you can see? What is your room asking of you?'),
('weekly-mentee-w8-recap-q2','weekly','mentee',8,'Learning Environment Design','Previous Week Recap',2,
 'As you close out Domain 2 this week, what feels solid and what still feels fragile?'),
('weekly-mentee-w8-strategies-q1','weekly','mentee',8,'Learning Environment Design','Strategies Used & Outcomes',1,
 'Walk through your classroom in your mind. Which areas of the room are getting used the way you intended? Which are not?'),
('weekly-mentee-w8-strategies-q2','weekly','mentee',8,'Learning Environment Design','Strategies Used & Outcomes',2,
 'Describe one change you made (or want to make) to your physical environment that supports the kind of learning you want to see.'),
('weekly-mentee-w8-strategies-q3','weekly','mentee',8,'Learning Environment Design','Strategies Used & Outcomes',3,
 'What in your environment communicates your values to children — even when you''re not saying anything?'),
('weekly-mentee-w8-goals-q1','weekly','mentee',8,'Learning Environment Design','Goals for the Week Ahead',1,
 'Identify one specific change you will make to your environment this week. What problem will it solve?'),
('weekly-mentee-w8-goals-q2','weekly','mentee',8,'Learning Environment Design','Goals for the Week Ahead',2,
 'As you cross from Domain 2 into Domain 3, what is one piece of environmental or organizational work you want to keep returning to?'),
('weekly-mentee-w8-data-q1','weekly','mentee',8,'Learning Environment Design','Data, Assessment & Progress',1,
 'Where in your room do children seem most calm and focused? Where do they seem most scattered? What is the environment doing in each case?'),
('weekly-mentee-w8-data-q2','weekly','mentee',8,'Learning Environment Design','Data, Assessment & Progress',2,
 'How much of the visual / material content in your room is current, alive, and from this group of children — vs. left over from before?');

-- ─── WEEK 9: Concept Development ────────────────────────────────────
INSERT INTO reflection_questions (question_id, reflection_type, role, week_number, topic, section, question_order, question_text) VALUES
('weekly-mentee-w9-recap-q1','weekly','mentee',9,'Concept Development','Previous Week Recap',1,
 'You''ve completed Domains 1 and 2. As you enter Domain 3 — Instructional Depth & Language — how is your sense of yourself as a teacher different than at Week 1?'),
('weekly-mentee-w9-recap-q2','weekly','mentee',9,'Concept Development','Previous Week Recap',2,
 'What has your environment work freed up for you to focus on now?'),
('weekly-mentee-w9-strategies-q1','weekly','mentee',9,'Concept Development','Strategies Used & Outcomes',1,
 'Describe a moment this week when you helped a child make a real connection — between ideas, experiences, or stories. What did the conversation sound like?'),
('weekly-mentee-w9-strategies-q2','weekly','mentee',9,'Concept Development','Strategies Used & Outcomes',2,
 'When did you push children to think deeper this week instead of accepting a quick answer? What did you say to do that?'),
('weekly-mentee-w9-strategies-q3','weekly','mentee',9,'Concept Development','Strategies Used & Outcomes',3,
 'Where did you miss a chance to deepen the thinking? What would you do differently next time?'),
('weekly-mentee-w9-goals-q1','weekly','mentee',9,'Concept Development','Goals for the Week Ahead',1,
 'Identify one topic or activity coming up next week where you want to plan deeper questions in advance. What will you ask?'),
('weekly-mentee-w9-goals-q2','weekly','mentee',9,'Concept Development','Goals for the Week Ahead',2,
 'What is one phrase you want to add to your teaching to push children''s thinking ("Why do you think...?", "What if...?", "How is that like...?")?'),
('weekly-mentee-w9-data-q1','weekly','mentee',9,'Concept Development','Data, Assessment & Progress',1,
 'When children explain their thinking out loud right now, what do you hear? Where is the depth showing up?'),
('weekly-mentee-w9-data-q2','weekly','mentee',9,'Concept Development','Data, Assessment & Progress',2,
 'Which children are doing real thinking aloud this week? Which are still mostly answering on autopilot?');

-- ─── WEEK 10: Quality of Feedback ───────────────────────────────────
INSERT INTO reflection_questions (question_id, reflection_type, role, week_number, topic, section, question_order, question_text) VALUES
('weekly-mentee-w10-recap-q1','weekly','mentee',10,'Quality of Feedback','Previous Week Recap',1,
 'Last week was about deepening thinking. What was a moment when you heard a child say something that genuinely surprised you?'),
('weekly-mentee-w10-recap-q2','weekly','mentee',10,'Quality of Feedback','Previous Week Recap',2,
 'How is your own questioning changing? What are you noticing about the words you reach for?'),
('weekly-mentee-w10-strategies-q1','weekly','mentee',10,'Quality of Feedback','Strategies Used & Outcomes',1,
 'Describe a moment this week when you gave a child specific, useful feedback that helped them keep going. What made it land?'),
('weekly-mentee-w10-strategies-q2','weekly','mentee',10,'Quality of Feedback','Strategies Used & Outcomes',2,
 'How often did you find yourself defaulting to "good job" this week? What more specific responses did you reach for instead?'),
('weekly-mentee-w10-strategies-q3','weekly','mentee',10,'Quality of Feedback','Strategies Used & Outcomes',3,
 'When did you give a child feedback that didn''t move their learning forward? What might have been more helpful?'),
('weekly-mentee-w10-goals-q1','weekly','mentee',10,'Quality of Feedback','Goals for the Week Ahead',1,
 'What is one phrase you want to retire from your feedback habits, and one phrase you want to add?'),
('weekly-mentee-w10-goals-q2','weekly','mentee',10,'Quality of Feedback','Goals for the Week Ahead',2,
 'Identify one child whose work you want to give more specific, growth-oriented feedback to next week. Why that child?'),
('weekly-mentee-w10-data-q1','weekly','mentee',10,'Quality of Feedback','Data, Assessment & Progress',1,
 'What are you saying most often when children show you their work? Listen to yourself this week and write what you hear.'),
('weekly-mentee-w10-data-q2','weekly','mentee',10,'Quality of Feedback','Data, Assessment & Progress',2,
 'Which children seem to use your feedback to push further? Which seem to take it as the end of the conversation?');

-- ─── WEEK 11: Language Modeling ─────────────────────────────────────
INSERT INTO reflection_questions (question_id, reflection_type, role, week_number, topic, section, question_order, question_text) VALUES
('weekly-mentee-w11-recap-q1','weekly','mentee',11,'Language Modeling','Previous Week Recap',1,
 'After working on feedback last week, what changed in how children responded to you?'),
('weekly-mentee-w11-recap-q2','weekly','mentee',11,'Language Modeling','Previous Week Recap',2,
 'As you head into Week 11 of 12, where do you feel the most growth in your teaching? What is still on your edge?'),
('weekly-mentee-w11-strategies-q1','weekly','mentee',11,'Language Modeling','Strategies Used & Outcomes',1,
 'Describe a conversation this week where you really stretched a child''s language — new words, longer sentences, more complete ideas. What did you do?'),
('weekly-mentee-w11-strategies-q2','weekly','mentee',11,'Language Modeling','Strategies Used & Outcomes',2,
 'What new vocabulary did you introduce this week, and how naturally did it fit into the day?'),
('weekly-mentee-w11-strategies-q3','weekly','mentee',11,'Language Modeling','Strategies Used & Outcomes',3,
 'When did you talk too much this week? When did you talk too little? What''s the right balance for your children right now?'),
('weekly-mentee-w11-goals-q1','weekly','mentee',11,'Language Modeling','Goals for the Week Ahead',1,
 'Identify three "stretch words" you want to weave into your conversations next week. Why those three?'),
('weekly-mentee-w11-goals-q2','weekly','mentee',11,'Language Modeling','Goals for the Week Ahead',2,
 'What is one child whose language you want to help expand specifically — and what will you try?'),
('weekly-mentee-w11-data-q1','weekly','mentee',11,'Language Modeling','Data, Assessment & Progress',1,
 'How rich is the language in your room right now? What kinds of words are children using on their own?'),
('weekly-mentee-w11-data-q2','weekly','mentee',11,'Language Modeling','Data, Assessment & Progress',2,
 'How much of the talking in your room is you, and how much is the children? Has that ratio shifted over these eleven weeks?');

-- ─── WEEK 12: Higher-Order Questioning ──────────────────────────────
INSERT INTO reflection_questions (question_id, reflection_type, role, week_number, topic, section, question_order, question_text) VALUES
('weekly-mentee-w12-recap-q1','weekly','mentee',12,'Higher-Order Questioning','Previous Week Recap',1,
 'You''re in your final week of the program. Take a moment to look back at the teacher you were 12 weeks ago. What do you want to say to her?'),
('weekly-mentee-w12-recap-q2','weekly','mentee',12,'Higher-Order Questioning','Previous Week Recap',2,
 'Of everything you''ve practiced over 12 weeks, what feels permanent now? What is still a stretch?'),
('weekly-mentee-w12-strategies-q1','weekly','mentee',12,'Higher-Order Questioning','Strategies Used & Outcomes',1,
 'Describe a moment this week when you asked a question that genuinely pushed children to think harder than the question alone required. What was the question, and what came back?'),
('weekly-mentee-w12-strategies-q2','weekly','mentee',12,'Higher-Order Questioning','Strategies Used & Outcomes',2,
 'When did you wait long enough this week — really long enough — for children to think before answering? What happened in that silence?'),
('weekly-mentee-w12-strategies-q3','weekly','mentee',12,'Higher-Order Questioning','Strategies Used & Outcomes',3,
 'Where did you settle for a yes/no question this week when something deeper was right there? What could you have asked?'),
('weekly-mentee-w12-goals-q1','weekly','mentee',12,'Higher-Order Questioning','Goals for the Week Ahead',1,
 'The program is ending — but the practice isn''t. Identify one habit from these 12 weeks you commit to keeping for the next 12 weeks on your own.'),
('weekly-mentee-w12-goals-q2','weekly','mentee',12,'Higher-Order Questioning','Goals for the Week Ahead',2,
 'What is one question you want to keep in your back pocket as your default "deepen the thinking" tool?'),
('weekly-mentee-w12-data-q1','weekly','mentee',12,'Higher-Order Questioning','Data, Assessment & Progress',1,
 'Across these 12 weeks, what is the change in your children that you can name most clearly?'),
('weekly-mentee-w12-data-q2','weekly','mentee',12,'Higher-Order Questioning','Data, Assessment & Progress',2,
 'What is the change in YOU that you can name most clearly?');

-- ════════════════════════════════════════════════════════════════════
-- DAILY REFLECTIONS — MENTEE
-- ════════════════════════════════════════════════════════════════════
-- Same five questions every day, with the topic word swapped in. We
-- store the actual topic on each row so the UI can render the right
-- weekly focus area without lookups.

-- Topic-by-week constants for the daily Q1:
--   1: Positive Climate
--   2: Teacher Sensitivity
--   3: Regard for Child Perspective
--   4: Negative Climate (Absence of)
--   5: Behavior Management
--   6: Productivity
--   7: Instructional Learning Formats
--   8: Learning Environment Design
--   9: Concept Development
--   10: Quality of Feedback
--   11: Language Modeling
--   12: Higher-Order Questioning

DO $$
DECLARE
  topics TEXT[] := ARRAY[
    'Positive Climate','Teacher Sensitivity','Regard for Child Perspective','Negative Climate (Absence of)',
    'Behavior Management','Productivity','Instructional Learning Formats','Learning Environment Design',
    'Concept Development','Quality of Feedback','Language Modeling','Higher-Order Questioning'
  ];
  w INTEGER;
  topic TEXT;
BEGIN
  FOR w IN 1..12 LOOP
    topic := topics[w];

    -- Q1
    INSERT INTO reflection_questions (question_id, reflection_type, role, week_number, topic, section, question_order, question_text) VALUES
    ('daily-mentee-w'||w||'-q1','daily','mentee',w,topic,'Daily Reflection',1,
     'Today''s focus area was '||topic||'. In one to two sentences, describe the most significant moment in your classroom today — positive or challenging — related to this topic.');
    -- Q2
    INSERT INTO reflection_questions (question_id, reflection_type, role, week_number, topic, section, question_order, question_text) VALUES
    ('daily-mentee-w'||w||'-q2','daily','mentee',w,topic,'Daily Reflection',2,
     'What is one thing you tried today that was intentional or new? What was the immediate outcome?');
    -- Q3
    INSERT INTO reflection_questions (question_id, reflection_type, role, week_number, topic, section, question_order, question_text) VALUES
    ('daily-mentee-w'||w||'-q3','daily','mentee',w,topic,'Daily Reflection',3,
     'Is there a child, interaction, or pattern from today that you want to bring to your next mentor conversation? Why does it stand out?');
    -- Q4
    INSERT INTO reflection_questions (question_id, reflection_type, role, week_number, topic, section, question_order, question_text, scale_type) VALUES
    ('daily-mentee-w'||w||'-q4','daily','mentee',w,topic,'Daily Reflection',4,
     'On a scale of 1–5, how present and effective did you feel today? What influenced that number most?','rating_5');
    -- Q5
    INSERT INTO reflection_questions (question_id, reflection_type, role, week_number, topic, section, question_order, question_text) VALUES
    ('daily-mentee-w'||w||'-q5','daily','mentee',w,topic,'Daily Reflection',5,
     'What is one thing you will do differently or build on tomorrow based on what you observed or experienced today?');
    -- Bridge
    INSERT INTO reflection_questions (question_id, reflection_type, role, week_number, topic, section, question_order, question_text) VALUES
    ('daily-mentee-w'||w||'-bridge','daily','mentee',w,topic,'Bridge to Weekly Reflection',6,
     'Use this space to identify the 1–2 daily moments most worth carrying into your Weekly Reflection.');
  END LOOP;
END $$;

-- ════════════════════════════════════════════════════════════════════
-- DAILY REFLECTIONS — MENTOR
-- ════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  topics TEXT[] := ARRAY[
    'Positive Climate','Teacher Sensitivity','Regard for Child Perspective','Negative Climate (Absence of)',
    'Behavior Management','Productivity','Instructional Learning Formats','Learning Environment Design',
    'Concept Development','Quality of Feedback','Language Modeling','Higher-Order Questioning'
  ];
  w INTEGER;
  topic TEXT;
BEGIN
  FOR w IN 1..12 LOOP
    topic := topics[w];

    INSERT INTO reflection_questions (question_id, reflection_type, role, week_number, topic, section, question_order, question_text) VALUES
    ('daily-mentor-w'||w||'-q1','daily','mentor',w,topic,'Daily Reflection',1,
     'Based on your observation or interaction today, what evidence of growth did you notice in your mentee related to '||topic||'?');
    INSERT INTO reflection_questions (question_id, reflection_type, role, week_number, topic, section, question_order, question_text) VALUES
    ('daily-mentor-w'||w||'-q2','daily','mentor',w,topic,'Daily Reflection',2,
     'What is one area where your mentee needs additional support, modeling, or a different approach in the days ahead?');
    INSERT INTO reflection_questions (question_id, reflection_type, role, week_number, topic, section, question_order, question_text) VALUES
    ('daily-mentor-w'||w||'-q3','daily','mentor',w,topic,'Daily Reflection',3,
     'How effectively did you facilitate today''s coaching conversation? Was there a moment where you could have asked a better question or listened more deeply?');
    INSERT INTO reflection_questions (question_id, reflection_type, role, week_number, topic, section, question_order, question_text) VALUES
    ('daily-mentor-w'||w||'-q4','daily','mentor',w,topic,'Daily Reflection',4,
     'What is one specific strategy or resource you want to bring to your next session based on what you observed today?');
    INSERT INTO reflection_questions (question_id, reflection_type, role, week_number, topic, section, question_order, question_text, scale_type) VALUES
    ('daily-mentor-w'||w||'-q5','daily','mentor',w,topic,'Daily Reflection',5,
     'On a scale of 1–5, how would you rate the quality of today''s mentoring interaction? What contributed to that rating?','rating_5');
    INSERT INTO reflection_questions (question_id, reflection_type, role, week_number, topic, section, question_order, question_text) VALUES
    ('daily-mentor-w'||w||'-bridge','daily','mentor',w,topic,'Bridge to Weekly Reflection',6,
     'Use this space to identify the 1–2 daily moments most worth carrying into your Weekly Reflection.');
  END LOOP;
END $$;

-- ════════════════════════════════════════════════════════════════════
-- END-OF-DOMAIN REFLECTIONS — MENTEE
-- ════════════════════════════════════════════════════════════════════
-- Three of these total: after Domain 1 (Week 4), Domain 2 (Week 8),
-- Domain 3 (Week 12). Per Rebecca's guide, these are honest assessments
-- of the relationship and program quality.

INSERT INTO reflection_questions (question_id, reflection_type, role, domain_number, topic, section, question_order, question_text) VALUES
('eod-mentee-d1-q1','end_of_domain','mentee',1,'Emotional Climate & Responsiveness','Domain Experience',1,
 'Looking back at Domain 1, what is the most significant shift you can name in your own teaching practice over these four weeks?'),
('eod-mentee-d1-q2','end_of_domain','mentee',1,'Emotional Climate & Responsiveness','Domain Experience',2,
 'Which of the four topics — Positive Climate, Teacher Sensitivity, Regard for Child Perspective, Absence of Negative Climate — was the hardest for you, and why?'),
('eod-mentee-d1-q3','end_of_domain','mentee',1,'Emotional Climate & Responsiveness','Mentoring Relationship',3,
 'How is your mentoring relationship feeling so far? What is working well, and what could be different?'),
('eod-mentee-d1-q4','end_of_domain','mentee',1,'Emotional Climate & Responsiveness','Mentoring Relationship',4,
 'What is one thing your mentor does that has been especially helpful? What is one thing you need more of from them?'),
('eod-mentee-d1-q5','end_of_domain','mentee',1,'Emotional Climate & Responsiveness','Program Feedback',5,
 'What part of the program (reflections, observations, materials, conversations) has been most useful so far?'),
('eod-mentee-d1-q6','end_of_domain','mentee',1,'Emotional Climate & Responsiveness','Program Feedback',6,
 'What is missing? What would make this program more meaningful for you in Domain 2?');

INSERT INTO reflection_questions (question_id, reflection_type, role, domain_number, topic, section, question_order, question_text, scale_type) VALUES
('eod-mentee-d1-rating','end_of_domain','mentee',1,'Emotional Climate & Responsiveness','Program Feedback',7,
 'Overall, how would you rate your experience in Domain 1 on a scale of 1–5?','rating_5');

INSERT INTO reflection_questions (question_id, reflection_type, role, domain_number, topic, section, question_order, question_text) VALUES
('eod-mentee-d2-q1','end_of_domain','mentee',2,'Learning Environment & Organization','Domain Experience',1,
 'Looking back at Domain 2, how has your sense of what a well-organized classroom looks and feels like changed?'),
('eod-mentee-d2-q2','end_of_domain','mentee',2,'Learning Environment & Organization','Domain Experience',2,
 'Of the four topics — Behavior Management, Productivity, Instructional Learning Formats, Learning Environment Design — which one most changed your daily practice?'),
('eod-mentee-d2-q3','end_of_domain','mentee',2,'Learning Environment & Organization','Mentoring Relationship',3,
 'How has your mentoring relationship deepened (or not) since Domain 1? What feels different now than it did at Week 4?'),
('eod-mentee-d2-q4','end_of_domain','mentee',2,'Learning Environment & Organization','Mentoring Relationship',4,
 'Is there anything you wish you could say to your mentor that you haven''t felt able to say yet? What would help?'),
('eod-mentee-d2-q5','end_of_domain','mentee',2,'Learning Environment & Organization','Program Feedback',5,
 'What about the program structure is working well for you? What would you change?'),
('eod-mentee-d2-q6','end_of_domain','mentee',2,'Learning Environment & Organization','Program Feedback',6,
 'As you head into Domain 3 (Instructional Depth & Language), what do you most want to grow in?');

INSERT INTO reflection_questions (question_id, reflection_type, role, domain_number, topic, section, question_order, question_text, scale_type) VALUES
('eod-mentee-d2-rating','end_of_domain','mentee',2,'Learning Environment & Organization','Program Feedback',7,
 'Overall, how would you rate your experience in Domain 2 on a scale of 1–5?','rating_5');

INSERT INTO reflection_questions (question_id, reflection_type, role, domain_number, topic, section, question_order, question_text) VALUES
('eod-mentee-d3-q1','end_of_domain','mentee',3,'Instructional Depth & Language','Domain Experience',1,
 'You''ve completed all 12 weeks. What is the single biggest change in your teaching that you can name?'),
('eod-mentee-d3-q2','end_of_domain','mentee',3,'Instructional Depth & Language','Domain Experience',2,
 'Of the four Domain 3 topics — Concept Development, Quality of Feedback, Language Modeling, Higher-Order Questioning — which one will stay with you longest?'),
('eod-mentee-d3-q3','end_of_domain','mentee',3,'Instructional Depth & Language','Mentoring Relationship',3,
 'Reflect on your full mentoring relationship. What has it given you? What were its limits?'),
('eod-mentee-d3-q4','end_of_domain','mentee',3,'Instructional Depth & Language','Mentoring Relationship',4,
 'If you were going to thank your mentor for one specific thing, what would it be?'),
('eod-mentee-d3-q5','end_of_domain','mentee',3,'Instructional Depth & Language','Program Feedback',5,
 'What worked best about this program for you?'),
('eod-mentee-d3-q6','end_of_domain','mentee',3,'Instructional Depth & Language','Program Feedback',6,
 'What didn''t work, or felt less valuable? Be honest — your feedback shapes what comes next.'),
('eod-mentee-d3-q7','end_of_domain','mentee',3,'Instructional Depth & Language','Program Feedback',7,
 'What would you tell another teacher who is about to start this program?');

INSERT INTO reflection_questions (question_id, reflection_type, role, domain_number, topic, section, question_order, question_text, scale_type) VALUES
('eod-mentee-d3-rating','end_of_domain','mentee',3,'Instructional Depth & Language','Program Feedback',8,
 'Overall, how would you rate your full 12-week program experience on a scale of 1–5?','rating_5');

-- ════════════════════════════════════════════════════════════════════
-- END-OF-DOMAIN REFLECTIONS — MENTOR
-- ════════════════════════════════════════════════════════════════════

INSERT INTO reflection_questions (question_id, reflection_type, role, domain_number, topic, section, question_order, question_text) VALUES
('eod-mentor-d1-q1','end_of_domain','mentor',1,'Emotional Climate & Responsiveness','Mentee Growth',1,
 'Looking back at Domain 1, what is the most significant growth you''ve seen in your mentee over these four weeks?'),
('eod-mentor-d1-q2','end_of_domain','mentor',1,'Emotional Climate & Responsiveness','Mentee Growth',2,
 'Which of the four topics did your mentee struggle with most? What does that tell you about where to focus your support next?'),
('eod-mentor-d1-q3','end_of_domain','mentor',1,'Emotional Climate & Responsiveness','My Coaching',3,
 'How would you assess the quality of your own coaching during Domain 1? Where were you strongest? Where do you want to grow?'),
('eod-mentor-d1-q4','end_of_domain','mentor',1,'Emotional Climate & Responsiveness','My Coaching',4,
 'What is one coaching habit you want to bring more intentionally into Domain 2?'),
('eod-mentor-d1-q5','end_of_domain','mentor',1,'Emotional Climate & Responsiveness','Relationship Health',5,
 'How is the trust and openness in your mentoring relationship right now? What evidence supports your read?'),
('eod-mentor-d1-q6','end_of_domain','mentor',1,'Emotional Climate & Responsiveness','Program Feedback',6,
 'What about the program''s structure is helping your work? What is getting in the way?');

INSERT INTO reflection_questions (question_id, reflection_type, role, domain_number, topic, section, question_order, question_text, scale_type) VALUES
('eod-mentor-d1-rating','end_of_domain','mentor',1,'Emotional Climate & Responsiveness','Program Feedback',7,
 'Overall, how would you rate the effectiveness of Domain 1 for your mentee on a scale of 1–5?','rating_5');

INSERT INTO reflection_questions (question_id, reflection_type, role, domain_number, topic, section, question_order, question_text) VALUES
('eod-mentor-d2-q1','end_of_domain','mentor',2,'Learning Environment & Organization','Mentee Growth',1,
 'Across Domain 2, what shifts have you seen in how your mentee runs their classroom day-to-day?'),
('eod-mentor-d2-q2','end_of_domain','mentor',2,'Learning Environment & Organization','Mentee Growth',2,
 'Where does your mentee have a clear pattern of strength now that wasn''t there at the start of Domain 1? Where is growth still slow?'),
('eod-mentor-d2-q3','end_of_domain','mentor',2,'Learning Environment & Organization','My Coaching',3,
 'What feedback have you given that landed well? What feedback have you given that fell flat? What does that tell you?'),
('eod-mentor-d2-q4','end_of_domain','mentor',2,'Learning Environment & Organization','My Coaching',4,
 'Have you been honest enough in your feedback? Have you been kind enough? Where is the harder edge for you?'),
('eod-mentor-d2-q5','end_of_domain','mentor',2,'Learning Environment & Organization','Relationship Health',5,
 'How would your mentee describe this relationship if asked? Be honest with yourself.'),
('eod-mentor-d2-q6','end_of_domain','mentor',2,'Learning Environment & Organization','Program Feedback',6,
 'As you head into Domain 3, what would make your job as a mentor easier?');

INSERT INTO reflection_questions (question_id, reflection_type, role, domain_number, topic, section, question_order, question_text, scale_type) VALUES
('eod-mentor-d2-rating','end_of_domain','mentor',2,'Learning Environment & Organization','Program Feedback',7,
 'Overall, how would you rate the effectiveness of Domain 2 for your mentee on a scale of 1–5?','rating_5');

INSERT INTO reflection_questions (question_id, reflection_type, role, domain_number, topic, section, question_order, question_text) VALUES
('eod-mentor-d3-q1','end_of_domain','mentor',3,'Instructional Depth & Language','Mentee Growth',1,
 'Reflect on your mentee''s full 12-week journey. What is the most important growth you witnessed?'),
('eod-mentor-d3-q2','end_of_domain','mentor',3,'Instructional Depth & Language','Mentee Growth',2,
 'What growth would you have expected to see that you didn''t? What might have been getting in the way?'),
('eod-mentor-d3-q3','end_of_domain','mentor',3,'Instructional Depth & Language','My Coaching',3,
 'What did you learn about yourself as a mentor through this experience?'),
('eod-mentor-d3-q4','end_of_domain','mentor',3,'Instructional Depth & Language','My Coaching',4,
 'If you mentored another teacher tomorrow, what is one thing you would do differently from the start?'),
('eod-mentor-d3-q5','end_of_domain','mentor',3,'Instructional Depth & Language','Relationship Health',5,
 'How are you closing this relationship well? What does your mentee need to hear from you at the end?'),
('eod-mentor-d3-q6','end_of_domain','mentor',3,'Instructional Depth & Language','Program Feedback',6,
 'What worked best about this program from a mentor''s perspective?'),
('eod-mentor-d3-q7','end_of_domain','mentor',3,'Instructional Depth & Language','Program Feedback',7,
 'What didn''t work? What would you change if you helped design the next version?');

INSERT INTO reflection_questions (question_id, reflection_type, role, domain_number, topic, section, question_order, question_text, scale_type) VALUES
('eod-mentor-d3-rating','end_of_domain','mentor',3,'Instructional Depth & Language','Program Feedback',8,
 'Overall, how would you rate the program''s effectiveness for your mentee across all 12 weeks on a scale of 1–5?','rating_5');

COMMIT;

-- ════════════════════════════════════════════════════════════════════
-- POST-SEED REPORT
-- ════════════════════════════════════════════════════════════════════

\echo ''
\echo '════════════════════════════════════════════════════════════'
\echo 'REFLECTION SEED REPORT'
\echo '════════════════════════════════════════════════════════════'

\echo ''
\echo '── Question counts by reflection type and role ──'
SELECT reflection_type, role, COUNT(*) AS question_count
  FROM reflection_questions
  GROUP BY reflection_type, role
  ORDER BY reflection_type, role;

\echo ''
\echo '── Weekly questions per week (mentee) ──'
SELECT week_number, topic, COUNT(*) AS question_count
  FROM reflection_questions
  WHERE reflection_type='weekly'
  GROUP BY week_number, topic
  ORDER BY week_number;

\echo ''
\echo '── Total questions seeded ──'
SELECT COUNT(*) AS total_questions FROM reflection_questions;

\echo ''
\echo '════════════════════════════════════════════════════════════'
\echo 'NOTE'
\echo '════════════════════════════════════════════════════════════'
\echo 'Weeks 1 and 2 use the exact wording from Rebecca'\''s guide.'
\echo 'Weeks 3-12 use the same structural pattern with topic-specific'
\echo 'questions written to fit the curriculum. To swap in Rebecca'\''s'
\echo 'final wording later, edit the question_text field directly,'
\echo 'or re-run this seed script after editing — it is idempotent.'
\echo '════════════════════════════════════════════════════════════'
