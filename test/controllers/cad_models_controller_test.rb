require "test_helper"

class CadModelsControllerTest < ActionDispatch::IntegrationTest
  setup do
    @cad_model = cad_models(:one)
  end

  test "should get index" do
    get cad_models_url
    assert_response :success
  end

  test "should get new" do
    get new_cad_model_url
    assert_response :success
  end

  test "should create cad_model" do
    assert_difference("CadModel.count") do
      post cad_models_url, params: { cad_model: { description: @cad_model.description, file_format: @cad_model.file_format, name: @cad_model.name } }
    end

    assert_redirected_to cad_model_url(CadModel.last)
  end

  test "should show cad_model" do
    get cad_model_url(@cad_model)
    assert_response :success
  end

  test "should get edit" do
    get edit_cad_model_url(@cad_model)
    assert_response :success
  end

  test "should update cad_model" do
    patch cad_model_url(@cad_model), params: { cad_model: { description: @cad_model.description, file_format: @cad_model.file_format, name: @cad_model.name } }
    assert_redirected_to cad_model_url(@cad_model)
  end

  test "should destroy cad_model" do
    assert_difference("CadModel.count", -1) do
      delete cad_model_url(@cad_model)
    end

    assert_redirected_to cad_models_url
  end
end
