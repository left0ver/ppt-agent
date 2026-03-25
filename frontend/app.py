import logging
import uuid

import requests
import streamlit as st
from enum import Enum
from agent.app import TimeLine, InterruptType
from functools import partial

logging.basicConfig(level=logging.INFO)

if "messages" not in st.session_state:
    st.session_state.messages = [
        # {"role": "assistant", "content": "Let's start chatting! 👇"}
    ]
if "__interrupt__" not in st.session_state:
    st.session_state.__interrupt__ = []
if "have_ppt_content_files" not in st.session_state:
    st.session_state.have_ppt_content_files = False
# # Display chat messages from history on app rerun
for message in st.session_state.messages:
    with st.chat_message(message["role"]):
        st.markdown(message["content"])

# # Accept user input
# if prompt := st.chat_input("What is up?"):

#     # Add user message to chat history
#     st.session_state.messages.append({"role": "user", "content": prompt})
#     # Display user message in chat message container
#     with st.chat_message("user"):
#         st.markdown(prompt)

#     # Display assistant response in chat message container
#     with st.chat_message("assistant"):
#         message_placeholder = st.empty()
#         full_response = ""
#         assistant_response = random.choice(
#             [
#                 "Hello there! How can I assist you today?",
#                 "Hi, human! Is there anything I can help you with?",
#                 "Do you need help?",
#             ]
#         )
#         # Simulate stream of response with milliseconds delay
#         for chunk in assistant_response.split():
#             full_response += chunk + " "
#             time.sleep(0.05)
#             # Add a blinking cursor to simulate typing
#             message_placeholder.markdown(full_response + "▌")
#         message_placeholder.markdown(full_response)
#     # Add assistant response to chat history
#     st.session_state.messages.append({"role": "assistant", "content": full_response})


st.set_page_config(page_title="PPT Agent", page_icon="📄", layout="centered")

BACKEND_URL = st.sidebar.text_input("FastAPI 地址", "http://127.0.0.1:8000")


class Status(Enum):
    NO_START = "no_start"


if "thread_id" not in st.session_state:
    res = requests.get(BACKEND_URL + "/init_session").json()
    st.session_state.thread_id = res["thread_id"]
    logging.info(
        f"Initialized new session with thread_id: {st.session_state.thread_id}"
    )
    st.session_state.placeholder = "请输入PPT主题"
    current_timeline = requests.get(
        f"{BACKEND_URL}/timeline", params={"thread_id": st.session_state.thread_id}
    ).json()["current_timeline"]
    st.session_state.current_timeline = current_timeline
    print(f"{st.session_state.current_timeline}")


if prompt := st.chat_input(
    placeholder=st.session_state.placeholder,
):
    st.session_state.messages.append({"role": "user", "content": prompt})
    with st.chat_message("user"):
        st.markdown(prompt)

    response = requests.post(
        f"{BACKEND_URL}/chat",
        json={
            "user_message": prompt,
            "thread_id": st.session_state.thread_id,
            "timeline": st.session_state.current_timeline,
        },
    ).json()
    st.session_state.__interrupt__ = response["__interrupt__"]
    # 如果没有中断，则渲染内容
    if not response["__interrupt__"]:
        pass
        # assistant_response = response["response"]
        # st.session_state.messages.append(
        #     {"role": "assistant", "content": assistant_response}
        # )
        # st.chat_message("assistant").markdown(assistant_response)

    st.rerun()


def ppt_content_files_on_dismiss():
    st.session_state.have_ppt_content_files = False
    
    logging.info(f"have_ppt_content_files: {st.session_state.have_ppt_content_files}")
    st.rerun()



@st.dialog(
    "上传PPT内容相关的文件", dismissible=True, on_dismiss=ppt_content_files_on_dismiss
)
def upload_ppt_content_files():

    upload_files = st.file_uploader(
        label="上传PPT的内容相关的文件",
        type=["pdf", "docx", "markdown"],
        accept_multiple_files=True,
        label_visibility="hidden",
        max_upload_size=20,
    )
    st.caption(
        "您可以上传相关内容文件,agent将会根据你上传的文件中的内容来制作PPT.</br>如果没有,则agent会根据你的PPT的需求搜索相关的内容来完成PPT的制作",
        unsafe_allow_html=True,
    )
    col1, col2 = st.columns(2)

    with col1:
        st.button(
            "没有文件，直接跳过",
            use_container_width=True,
            type="secondary",
            on_click=ppt_content_files_on_dismiss,
        )
        # ppt_content_files_on_dismiss()

    with col2:
        if st.button(
            "上传并继续",
            type="primary",
            use_container_width=True,
        ):
            files = []
            if len(upload_files) <= 0:
                # TODO:
                st.toast("请先选择文件", duration=3)
            else:
                for f in upload_files:
                    files.append(
                        (
                            "files",
                            (
                                f.name,
                                f.getvalue(),
                                f.type or "application/octet-stream",
                            ),
                        )
                    )
                res = requests.post(
                    f"{BACKEND_URL}/upload_ppt_content_files",
                    data={
                        "thread_id": st.session_state.thread_id,
                        "timeline": st.session_state.current_timeline,
                    },
                    files=files if files else None,
                ).json()
                if res["status"] == "success":
                    st.session_state.have_ppt_content_files = True
                    st.toast("上传成功", duration="short")
                else:
                    st.toast(f"文件上传失败: {res['message']}", duration=3)
                    return
                
                res = requests.post(f"{BACKEND_URL}/resume_upload_ppt_content_files", json={
                    "thread_id": st.session_state.thread_id,
                    "have_ppt_content_files": st.session_state.have_ppt_content_files,
                    }).json()
                
                st.session_state.messages = res.get("messages", [])
                st.session_state.__interrupt__ = res.get("__interrupt__", [])
                
                logging.info(
                    f"have_ppt_content_files: {st.session_state.have_ppt_content_files}"
                )

                st.rerun()



# upload_ppt_content_files()
if st.session_state.__interrupt__:
    for interrupt in st.session_state.__interrupt__:
        interrupt_type: InterruptType = InterruptType(interrupt["value"]["type"])

        if interrupt_type == InterruptType.FORM:
            form_data = {}
            required_data = interrupt["value"]["required_data"]
            form_key = interrupt["value"].get("form_key", "default_form_key")
            with st.form(key=form_key, enter_to_submit=False):
                st.write(interrupt["value"]["title"])
                for key, item in required_data.items():
                    if item["type"] == "str":
                        form_data[key] = st.text_input(item["description"])
                    elif item["type"] == "int":
                        form_data[key] = st.number_input(item["description"], step=1)
                submitted = st.form_submit_button("提交")
                print("form_data:", form_data)
                print("submitted:", submitted)
            if submitted:
                res = requests.post(
                    f"{BACKEND_URL}/resume_ppt_info",
                    json={
                        "thread_id": st.session_state.thread_id,
                        "user_input": form_data,
                    },
                ).json()
                # TODO:
                # 处理 message
                # 渲染内容或者继续处理中断
                st.session_state.__interrupt__ = res.get("__interrupt__", [])
                st.session_state.messages = res.get("messages", [])

                logging.info(
                    f"Sent resume request with thread_id: {st.session_state.thread_id} and form_data: {form_data}"
                )
                # st.session_state.__interrupt__ = []
                st.rerun()

        elif interrupt_type == InterruptType.UPLOAD_PPT_CONTENT_FILES:
            upload_ppt_content_files()

        elif interrupt_type == InterruptType.UPLOAD_PPT_TEMPLATE:
            
            st.warning("请上传PPT模板，目前该功能尚未实现")    
