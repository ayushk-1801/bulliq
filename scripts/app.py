import streamlit as st
import requests

# --- Configuration ---
# REPLACE THIS with the actual IP address of your backend machine!
API_URL = "http://127.0.0.1:8000" 

# --- Initialize Session State ---
if 'questions' not in st.session_state:
    st.session_state.questions = []
    st.session_state.history = []
    st.session_state.attempt = 1
    st.session_state.passed = False
    st.session_state.feedback = ""
    st.session_state.score = 0

# --- User Interface ---
st.title("📈 AI Stock Market Readiness Test")
st.markdown("Pass with an **8/10 or higher** to unlock the next level of trading!")

if st.session_state.passed:
    st.success("✅ CONGRATULATIONS! You passed the test!")
    st.balloons()
    st.markdown(f"**Final Score:** {st.session_state.score}/10")
    st.code("Signal Sent: USER_IS_READY = TRUE", language="python")
    st.markdown("### Your Feedback:")
    st.write(st.session_state.feedback)
    if st.button("Restart Test"):
        st.session_state.clear()
        st.rerun()

else:
    # 1. Ask the API for questions
    if not st.session_state.questions:
        with st.spinner(f"Generating Test Attempt #{st.session_state.attempt} via API..."):
            try:
                res = requests.post(f"{API_URL}/generate_questions", json={"previously_asked": st.session_state.history})
                if res.status_code == 200:
                    st.session_state.questions = res.json().get("questions", [])
                    history_texts = [q["text"] for q in st.session_state.questions]
                    st.session_state.history.extend(history_texts)
                else:
                    st.error(f"API Error: {res.text}")
                    st.stop()
            except requests.exceptions.ConnectionError:
                st.error(f"Cannot connect to API at {API_URL}. Is the FastAPI server running and accessible?")
                st.stop()
    
    st.subheader(f"Attempt #{st.session_state.attempt}")
    
    if st.session_state.feedback:
        with st.expander("Review Previous Attempt Feedback", expanded=False):
            st.write(st.session_state.feedback)
            st.error(f"Previous Score: {st.session_state.score}/10")

    with st.form(key='quiz_form'):
        user_answers = []
        for i, q_data in enumerate(st.session_state.questions, 1):
            st.markdown("---")
            
            st.markdown(f"**Q{i}:** {q_data['text']}")
            
            # Since the API is sending a real internet link, Streamlit just loads it directly!
            if q_data['image_url']:
                st.image(q_data['image_url'], width='stretch')
            
            ans = st.text_input("Your Answer:", key=f"ans_{i}")
            user_answers.append(ans)
            
        submit_button = st.form_submit_button(label='Submit Test for Grading')

    # 2. Send answers to the API for grading
    if submit_button:
        if all(a.strip() != "" for a in user_answers):
            with st.spinner("Grading your test via API..."):
                qa_text = ""
                for i in range(10):
                    qa_text += f"Q{i+1}: {st.session_state.questions[i]['text']}\nAnswer: {user_answers[i]}\n\n"
                
                try:
                    res = requests.post(f"{API_URL}/grade_test", json={"qa_pairs": qa_text})
                    if res.status_code == 200:
                        data = res.json()
                        st.session_state.feedback = data["feedback"]
                        st.session_state.score = data["score"]
                        
                        if st.session_state.score >= 8:
                            st.session_state.passed = True
                        else:
                            st.session_state.questions = []
                            st.session_state.attempt += 1
                        
                        st.rerun()
                    else:
                        st.error("Error from API during grading.")
                except requests.exceptions.ConnectionError:
                    st.error("Lost connection to the API.")
        else:
            st.warning("Please answer all 10 questions before submitting!")