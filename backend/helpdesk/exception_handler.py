from rest_framework.views import exception_handler
from rest_framework.response import Response
from rest_framework import status


def custom_exception_handler(exc, context):
    response = exception_handler(exc, context)

    if response is not None:
        # Normalize all error responses to have 'detail' and 'errors'
        data = response.data

        if isinstance(data, dict):
            if 'detail' not in data:
                errors = []
                for field, messages in data.items():
                    if isinstance(messages, list):
                        for msg in messages:
                            if field == 'non_field_errors':
                                errors.append(str(msg))
                            else:
                                label = field.replace('_', ' ').title()
                                errors.append(f"{label}: {msg}")
                    elif isinstance(messages, str):
                        errors.append(str(messages))

                if errors:
                    response.data = {
                        'detail': errors[0],
                        'errors': errors,
                    }
            elif 'errors' not in data:
                response.data['errors'] = [str(data.get('detail', 'An error occurred.'))]

        return response

    # Unhandled exception — return generic JSON error, never HTML
    return Response(
        {
            'detail': 'An internal server error occurred.',
            'errors': ['An internal server error occurred. Please try again.'],
        },
        status=status.HTTP_500_INTERNAL_SERVER_ERROR
    )
