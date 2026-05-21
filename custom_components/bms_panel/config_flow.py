"""Config flow for BMS Smart Panel — простой single-instance setup."""
from __future__ import annotations

from homeassistant import config_entries
from homeassistant.data_entry_flow import FlowResult

from .const import DOMAIN


class BMSPanelConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Очень простой config flow — без полей, просто разрешает установку."""

    VERSION = 1

    async def async_step_user(self, user_input=None) -> FlowResult:
        # Single-instance — не даём добавлять второй раз
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()

        if user_input is not None:
            return self.async_create_entry(title="BMS Smart Panel", data={})

        return self.async_show_form(
            step_id="user",
            description_placeholders={
                "info": "Управление настенными BMS-панелями. После установки в сайдбаре HA "
                        "появится пункт 'BMS Panels' — там добавляйте панели и настраивайте их."
            },
        )
